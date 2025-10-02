import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required for production use");
}

const JWT_SECRET = process.env.SESSION_SECRET;
const JWT_EXPIRY = "7d";
const MAX_SESSION_EXPIRY_DAYS = 30;

export interface SessionPayload {
  did: string;
  sessionId: string;
}

export class AuthService {
  createSessionToken(did: string, sessionId: string): string {
    return jwt.sign({ did, sessionId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  }

  verifySessionToken(token: string): SessionPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as SessionPayload;
      return payload;
    } catch (error) {
      return null;
    }
  }

  generateSessionId(): string {
    return randomBytes(32).toString("hex");
  }

  extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    return null;
  }
}

export const authService = new AuthService();

export interface AuthRequest extends Request {
  session?: SessionPayload;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = authService.extractToken(req);
  
  if (!token) {
    return res.status(401).json({ error: "No authentication token provided" });
  }

  const payload = authService.verifySessionToken(token);
  
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Check session expiry from database
  const { storage } = await import("../storage");
  const dbSession = await storage.getSession(payload.sessionId);
  
  if (!dbSession) {
    return res.status(401).json({ error: "Session not found" });
  }

  // Check if session has expired
  const now = new Date();
  if (now > new Date(dbSession.expiresAt)) {
    // Try to refresh the token if refresh token exists
    if (dbSession.refreshToken) {
      console.log(`[AUTH] Access token expired for ${dbSession.userDid}, attempting refresh...`);
      
      const { pdsClient } = await import("./pds-client");
      const { didResolver } = await import("./did-resolver");
      
      // Get user's PDS endpoint
      const pdsEndpoint = await didResolver.resolveDIDToPDS(dbSession.userDid);
      if (!pdsEndpoint) {
        console.error(`[AUTH] Failed to resolve PDS endpoint for ${dbSession.userDid}`);
        await storage.deleteSession(payload.sessionId);
        return res.status(401).json({ error: "Session expired and could not be refreshed" });
      }

      // Attempt token refresh
      const refreshResult = await pdsClient.refreshAccessToken(
        pdsEndpoint,
        dbSession.refreshToken
      );

      if (refreshResult.success && refreshResult.data) {
        // Security: Verify the refreshed DID matches the session DID
        if (refreshResult.data.did !== dbSession.userDid) {
          console.error(`[AUTH] DID mismatch after refresh! Expected ${dbSession.userDid}, got ${refreshResult.data.did}`);
          await storage.deleteSession(payload.sessionId);
          return res.status(401).json({ error: "Session security verification failed" });
        }

        // Update session with new tokens
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 7); // 7 days from now

        await storage.updateSession(payload.sessionId, {
          accessToken: refreshResult.data.accessJwt,
          refreshToken: refreshResult.data.refreshJwt,
          expiresAt: newExpiresAt,
        });

        console.log(`[AUTH] Successfully refreshed token for ${dbSession.userDid}`);
        req.session = payload;
        return next();
      } else {
        // Refresh failed, delete session
        console.error(`[AUTH] Token refresh failed for ${dbSession.userDid}:`, refreshResult.error);
        await storage.deleteSession(payload.sessionId);
        return res.status(401).json({ error: "Session expired and could not be refreshed" });
      }
    } else {
      // No refresh token, just delete session
      await storage.deleteSession(payload.sessionId);
      return res.status(401).json({ error: "Session expired" });
    }
  }

  req.session = payload;
  next();
}
