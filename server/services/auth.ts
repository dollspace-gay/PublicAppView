import jwt from "jsonwebtoken";
import { randomBytes, createPublicKey } from "crypto";
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
      const verified = await this.verifyJWTSignature(token, signingDid, header.alg);
      
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
   * Convert raw ECDSA signature (r,s) to DER format
   */
  private toDERSignature(r: Buffer, s: Buffer): Buffer {
    // Remove leading zeros but keep at least one byte
    const trimLeadingZeros = (buf: Buffer): Buffer => {
      let i = 0;
      while (i < buf.length - 1 && buf[i] === 0) i++;
      return buf.slice(i);
    };

    let rBytes = trimLeadingZeros(r);
    let sBytes = trimLeadingZeros(s);

    // Add leading zero if high bit is set (to avoid negative interpretation)
    if (rBytes[0] & 0x80) rBytes = Buffer.concat([Buffer.from([0]), rBytes]);
    if (sBytes[0] & 0x80) sBytes = Buffer.concat([Buffer.from([0]), sBytes]);

    // Build DER sequence: 0x30 [length] 0x02 [r-length] [r] 0x02 [s-length] [s]
    const rEncoded = Buffer.concat([Buffer.from([0x02, rBytes.length]), rBytes]);
    const sEncoded = Buffer.concat([Buffer.from([0x02, sBytes.length]), sBytes]);
    const sequence = Buffer.concat([rEncoded, sEncoded]);

    return Buffer.concat([Buffer.from([0x30, sequence.length]), sequence]);
  }

  /**
   * Decode base58 string to Buffer
   */
  private decodeBase58(input: string): Buffer {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes: number[] = [];
    
    for (let i = 0; i < input.length; i++) {
      let value = ALPHABET.indexOf(input[i]);
      if (value < 0) throw new Error(`Invalid base58 character: ${input[i]}`);
      
      for (let j = 0; j < bytes.length; j++) {
        value += bytes[j] * 58;
        bytes[j] = value & 0xff;
        value >>= 8;
      }
      
      while (value > 0) {
        bytes.push(value & 0xff);
        value >>= 8;
      }
    }
    
    // Add leading zeros
    for (let i = 0; i < input.length && input[i] === '1'; i++) {
      bytes.push(0);
    }
    
    return Buffer.from(bytes.reverse());
  }

  /**
   * Verify JWT signature using DID's public key
   */
  private async verifyJWTSignature(token: string, signingDid: string, algorithm: string): Promise<boolean> {
    try {
      const { didResolver } = await import("./did-resolver");
      
      // Resolve DID to get public keys
      const didDocument = await didResolver.resolveDID(signingDid);
      
      if (!didDocument) {
        console.error(`[AUTH] Failed to resolve DID: ${signingDid}`);
        return false;
      }

      if (!didDocument.verificationMethod || didDocument.verificationMethod.length === 0) {
        console.error(`[AUTH] No verification methods in DID document for: ${signingDid}`);
        console.error(`[AUTH] DID document keys: ${JSON.stringify(Object.keys(didDocument))}`);
        return false;
      }

      // Try each verification method until one works
      for (const method of didDocument.verificationMethod) {
        let publicKey: any;

        // Handle publicKeyJwk format
        if (method.publicKeyJwk) {
          try {
            publicKey = createPublicKey({
              key: method.publicKeyJwk,
              format: 'jwk'
            });
          } catch (err) {
            continue;
          }
        }
        // Handle publicKeyMultibase format (used by AT Protocol)
        else if (method.publicKeyMultibase) {
          try {
            // Decode multibase string (z prefix = base58btc)
            const multibaseKey = method.publicKeyMultibase;
            if (!multibaseKey.startsWith('z')) {
              continue;
            }

            // Decode base58 (remove 'z' prefix)
            const base58 = multibaseKey.slice(1);
            const decoded = this.decodeBase58(base58);
            
            // Check for secp256k1-pub multicodec prefix (0xe7 0x01)
            if (decoded[0] === 0xe7 && decoded[1] === 0x01) {
              // Skip the 2-byte multicodec prefix
              const keyBytes = decoded.slice(2);
              
              // secp256k1 compressed public key (33 bytes: 0x02/0x03 + 32 bytes)
              // Create DER-encoded SubjectPublicKeyInfo structure for secp256k1
              const derPrefix = Buffer.from([
                0x30, 0x36, // SEQUENCE, 54 bytes
                0x30, 0x10, // SEQUENCE, 16 bytes (algorithm)
                0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID: ecPublicKey
                0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, // OID: secp256k1
                0x03, 0x22, 0x00 // BIT STRING, 34 bytes following, 0 unused bits
              ]);
              
              publicKey = createPublicKey({
                key: Buffer.concat([derPrefix, keyBytes]),
                format: 'der',
                type: 'spki'
              });
            } else {
              continue;
            }
          } catch (err) {
            continue;
          }
        } else {
          continue;
        }

        try {
          // For ES256K, we need to manually verify since jsonwebtoken doesn't support it
          if (algorithm === 'ES256K') {
            const [headerB64, payloadB64, signatureB64] = token.split('.');
            const message = `${headerB64}.${payloadB64}`;
            
            // Decode signature from base64url
            const signatureBuffer = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
            
            // ES256K signatures are 64 bytes (r and s components, 32 bytes each)
            // DER encoding needed for Node.js verify
            const r = signatureBuffer.slice(0, 32);
            const s = signatureBuffer.slice(32, 64);
            
            // Convert to DER format
            const derSignature = this.toDERSignature(r, s);
            
            // Verify using crypto
            const { createVerify } = await import('crypto');
            const verifier = createVerify('SHA256');
            verifier.update(message);
            verifier.end();
            
            const isValid = verifier.verify(publicKey, derSignature);
            
            if (!isValid) {
              throw new Error('Signature verification failed');
            }
          } else {
            // Use jsonwebtoken for other algorithms
            jwt.verify(token, publicKey, { 
              algorithms: [algorithm as jwt.Algorithm] 
            });
          }

          console.log(`[AUTH] Signature verified using key: ${method.id}`);
          return true;
        } catch (err) {
          console.log(`[AUTH] Signature verification failed with this key: ${err}`);
          // Try next key if this one doesn't work
          continue;
        }
      }

      console.error(`[AUTH] No valid signing key found for DID: ${signingDid}`);
      return false;
    } catch (error) {
      console.error(`[AUTH] Error verifying signature:`, error);
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
