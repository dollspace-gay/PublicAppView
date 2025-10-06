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
      console.error("[AUTH] JWT verification failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  generateSessionId(): string {
    return randomBytes(32).toString("hex");
  }

  extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      console.log(`[AUTH] Extracted Bearer token from ${req.path}: ${token.substring(0, 20)}...`);
      return token;
    }
    console.log(`[AUTH] No Bearer token found in Authorization header for ${req.path}`);
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

  const { storage } = await import("../storage");
  const dbSession = await storage.getSession(payload.sessionId);
  
  if (!dbSession) {
    return res.status(401).json({ error: "Session not found" });
  }

  const now = new Date();
  if (now > new Date(dbSession.expiresAt)) {
    if (dbSession.refreshToken) {
      console.log(`[AUTH] Access token expired for ${dbSession.userDid}, attempting refresh...`);
      
      const { pdsClient } = await import("./pds-client");
      const { didResolver } = await import("./did-resolver");
      
      const pdsEndpoint = await didResolver.resolveDIDToPDS(dbSession.userDid);
      if (pdsEndpoint) {
        const refreshResult = await pdsClient.refreshAccessToken(
          pdsEndpoint,
          dbSession.refreshToken
        );
        
        if (refreshResult.success && refreshResult.data) {
          const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await storage.updateSession(payload.sessionId, {
            accessToken: refreshResult.data.accessJwt,
            refreshToken: refreshResult.data.refreshJwt || dbSession.refreshToken,
            expiresAt: newExpiresAt,
          });
          
          console.log(`[AUTH] Successfully refreshed token for ${dbSession.userDid}`);
          req.session = payload;
          return next();
        }
      }
      
      await storage.deleteSession(payload.sessionId);
      return res.status(401).json({ error: "Session expired and could not be refreshed" });
    } else {
      await storage.deleteSession(payload.sessionId);
      return res.status(401).json({ error: "Session expired" });
    }
  }

  req.session = payload;
  next();
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    if (!req.session) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { adminAuthService } = await import("./admin-authorization");
    const isAdmin = await adminAuthService.isAdmin(req.session.did);

    if (!isAdmin) {
      return res.status(403).json({ 
        error: "Admin access required",
        message: "Your account is not authorized to access admin features. Contact your instance administrator."
      });
    }

    next();
  });
}
