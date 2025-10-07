import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";
import * as jose from 'jose';
import type { KeyObject, JWSHeaderParameters } from 'jose';
import { base58btc } from 'multiformats/bases/base58';
import { varint } from 'multiformats'

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

export interface AtProtoTokenPayload {
  sub: string; // User's DID
  iss: string; // Issuer (PDS endpoint)
  aud: string; // Audience (this appview's DID)
  scope: string;
  iat: number;
  exp: number;
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
      console.error("[AUTH] Local session JWT verification failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Verify AT Protocol OAuth access token from third-party clients
   * With full cryptographic signature verification
   */
  async verifyAtProtoToken(token: string): Promise<{ did: string } | null> {
    try {
      // Decode without verification to check token structure
      const decoded = jwt.decode(token, { complete: true }) as any;
      
      if (!decoded || !decoded.payload) {
        console.log("[AUTH] Failed to decode token");
        return null;
      }

      const header = decoded.header;
      const payload = decoded.payload;
      
      // AT Protocol supports two token formats:
      // 1. OAuth access tokens (RFC 9068): sub=userDID, iss=authServer, aud=resourceServer
      // 2. Service auth tokens: iss=userDID, aud=targetService, lxm=method
      
      let userDid: string | null = null;
      let signingDid: string | null = null;
      
      // Check for OAuth access token format (sub field with DID)
      if (payload.sub && typeof payload.sub === 'string' && payload.sub.startsWith("did:")) {
        userDid = payload.sub;
        signingDid = payload.iss; // Token signed by authorization server
      }
      // Check for AT Protocol service auth token format (iss field with DID, lxm field present)
      else if (payload.iss && typeof payload.iss === 'string' && payload.iss.startsWith("did:") && payload.lxm) {
        userDid = payload.iss;
        signingDid = payload.iss; // Token signed by user's DID
      }
      else {
        console.log(`[AUTH] Not an AT Protocol token - invalid structure`);
        return null;
      }

      if (!userDid || !signingDid) {
        return null;
      }

      // Verify signature using signing DID's public keys
      const verified = await this.verifyJWTSignature(token, signingDid);
      
      if (!verified) {
        console.error(`[AUTH] Signature verification failed for DID: ${signingDid}`);
        return null;
      }

      console.log(`[AUTH] ✓ AT Protocol token verified for DID: ${userDid} (signed by: ${signingDid})`);
      return { did: userDid };
    } catch (error) {
      console.error("[AUTH] AT Protocol token verification failed:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Verify JWT signature using a key from the DID document.
   * This function uses the `jose` library to robustly handle various key types
   * and algorithms found in AT Protocol DID documents (ES256, ES256K),
   * using the 'kid' header parameter for key selection.
   */
  private async verifyJWTSignature(token: string, signingDid: string): Promise<boolean> {
    try {
      const { didResolver } = await import("./did-resolver");
      const didDocument = await didResolver.resolveDID(signingDid);

      if (!didDocument || !didDocument.verificationMethod) {
        console.error(`[AUTH] No verification methods found for DID: ${signingDid}`);
        return false;
      }

      const getKey = async (protectedHeader: JWSHeaderParameters) => {
        const kid = protectedHeader.kid;
        if (!kid) {
          throw new Error("JWT missing 'kid' in protected header");
        }

        const verificationMethods = didDocument.verificationMethod || [];

        const method = verificationMethods.find(m => m.id.endsWith(`#${kid}`) || m.id === kid);

        if (!method) {
          throw new Error(`No verification method found for kid: ${kid}`);
        }

        if (method.publicKeyJwk) {
          return jose.importJWK(method.publicKeyJwk, protectedHeader.alg);
        }

        if (method.publicKeyMultibase) {
          const multicodecBytes = base58btc.decode(method.publicKeyMultibase);
          const [codec, bytesRead] = varint.decode(multicodecBytes);
          const keyBytes = multicodecBytes.subarray(bytesRead);

          if (codec === 0x1200) { // p256
            const derPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
            const spki = Buffer.concat([derPrefix, Buffer.from(keyBytes)]);
            return jose.importSPKI(spki.toString('base64'), protectedHeader.alg!);
          }

          if (codec === 0xe7) { // secp256k1
            const derPrefix = Buffer.from('3036301006072a8648ce3d020106052b8104000a032200', 'hex');
            const spki = Buffer.concat([derPrefix, Buffer.from(keyBytes)]);
            return jose.importSPKI(spki.toString('base64'), protectedHeader.alg!);
          }

          throw new Error(`Unsupported multicodec key type: ${codec}`);
        }

        throw new Error(`Verification method ${kid} has no supported key format (publicKeyJwk or publicKeyMultibase)`);
      };

      await jose.jwtVerify(token, getKey as any);

      console.log(`[AUTH] ✓ Signature verified for DID: ${signingDid}`);
      return true;

    } catch (error) {
      console.error(`[AUTH] Signature verification failed for DID ${signingDid}:`, error);
      return false;
    }
  }

  /**
   * Verify either local session token OR AT Protocol access token
   */
  async verifyToken(token: string): Promise<{ did: string; sessionId?: string } | null> {
    // Try local session token first (faster path for our own web UI)
    const sessionPayload = this.verifySessionToken(token);
    if (sessionPayload) {
      console.log(`[AUTH] ✓ Local session token verified for DID: ${sessionPayload.did}`);
      return sessionPayload;
    }

    // Try AT Protocol access token (for third-party clients)
    const atProtoPayload = await this.verifyAtProtoToken(token);
    if (atProtoPayload) {
      return atProtoPayload;
    }

    return null;
  }

  generateSessionId(): string {
    return randomBytes(32).toString("hex");
  }

  extractToken(req: Request): string | null {
    // 1. Check for cookie first (for web UI sessions)
    if (req.cookies && req.cookies.auth_token) {
      console.log(`[AUTH] Extracted token from cookie for ${req.path}`);
      return req.cookies.auth_token;
    }

    // 2. Fallback to Bearer token for API clients
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      console.log(`[AUTH] Extracted Bearer token from ${req.path}: ${token.substring(0, 20)}...`);
      return token;
    }

    console.log(`[AUTH] No token found in cookie or Authorization header for ${req.path}`);
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
