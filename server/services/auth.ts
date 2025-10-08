import jwt from "jsonwebtoken";
import { randomBytes, createPublicKey, verify } from "crypto";
import type { Request, Response, NextFunction } from "express";
import * as jose from 'jose';
import type { KeyObject, JWSHeaderParameters } from 'jose';
import KeyEncoder from 'key-encoder';
import { fromString, toString, concat } from 'uint8arrays';
import { base58btc } from 'multiformats/bases/base58';
import { varint } from 'multiformats';
import elliptic from 'elliptic';
const { ec: EC } = elliptic;

const verifyEs256kSig = (
  publicKey: Uint8Array,
  data: Uint8Array,
  sig: Uint8Array,
): boolean => {
  try {
    // The `key-encoder` library is a CJS module that, when bundled,
    // might be wrapped in a default object. This handles that case
    // by checking for a `default` property and using it if it exists.
    const KeyEncoderClass = (KeyEncoder as any).default || KeyEncoder;
    const keyEncoder = new KeyEncoderClass('secp256k1');
    const pemKey = keyEncoder.encodePublic(
      toString(publicKey, 'hex'),
      'raw',
      'pem',
    );
    const key = createPublicKey({ format: 'pem', key: pemKey });

    return verify(
      'sha256',
      data,
      {
        key,
        dsaEncoding: 'ieee-p1363',
      },
      sig,
    );
  } catch (err) {
    console.error('[AUTH] Error during ES256K signature verification:', err);
    return false;
  }
};

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
      // Decode the token to inspect the header without verifying the signature.
      // This allows us to quickly reject tokens that are not meant for this verification method.
      const decoded = jwt.decode(token, { complete: true });

      // Local session tokens are always signed with HS256. If the token has a different
      // algorithm, it's an AT-Proto token or something else, so we should not try to verify it here.
      if (decoded?.header.alg !== 'HS256') {
        return null; // Not a local session token, do not proceed.
      }

      // Now that we know it's an HS256 token, verify it with the secret.
      const payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      }) as SessionPayload;
      return payload;
    } catch (error) {
      // This block will now only be reached for actual verification errors of HS256 tokens
      // (e.g., signature mismatch, expiration), not for algorithm mismatches.
      console.log(
        '[AUTH] Local session token verification failed:',
        error instanceof Error ? error.message : error,
      );
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

  private async verifyJWTSignature(
    token: string,
    signingDid: string,
  ): Promise<boolean> {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split('.');
      if (!headerB64 || !payloadB64 || !signatureB64) {
        throw new Error('Invalid JWT structure');
      }
      const header = JSON.parse(
        toString(fromString(headerB64, 'base64url')),
      ) as JWSHeaderParameters;

      const { didResolver } = await import('./did-resolver');
      const didDocument = await didResolver.resolveDID(signingDid);

      if (!didDocument || !didDocument.verificationMethod) {
        console.error(`[AUTH] No verification methods found for DID: ${signingDid}`);
        return false;
      }

      const { kid } = header;
      const verificationMethods = didDocument.verificationMethod || [];

      let method;

      if (kid) {
        method = verificationMethods.find(
          (m) => m.id.endsWith(`#${kid}`) || m.id === kid,
        );
      } else {
        const atprotoKeys = verificationMethods.filter((m) =>
          m.id.endsWith('#atproto'),
        );
        if (atprotoKeys.length === 1) {
          console.log(
            `[AUTH] JWT missing 'kid', using unique #atproto key for DID ${signingDid}`,
          );
          method = atprotoKeys[0];
        } else {
          throw new Error(
            "JWT missing 'kid' and could not find a unique '#atproto' verification key.",
          );
        }
      }

      if (!method) {
        throw new Error(`No verification method found for kid: ${kid}`);
      }

      if (header.alg === 'ES256K') {
        // Manually verify ES256K signatures using native crypto
        const signingInput = fromString(`${headerB64}.${payloadB64}`);
        const signature = fromString(signatureB64, 'base64url');

        let publicKeyBytes: Uint8Array;

        if (method.publicKeyJwk) {
          const jwk = method.publicKeyJwk;
          if (jwk.crv !== 'secp256k1' || !jwk.x || !jwk.y) {
            throw new Error('Invalid JWK for ES256K');
          }
          const x = fromString(jwk.x, 'base64url');
          const y = fromString(jwk.y, 'base64url');
          publicKeyBytes = concat([new Uint8Array([0x04]), x, y]);
        } else if (method.publicKeyMultibase) {
          const multicodecBytes = base58btc.decode(method.publicKeyMultibase);
          const [codec, bytesRead] = varint.decode(multicodecBytes);
          if (codec !== 0xe7) throw new Error('Key is not ES256K');

          const keyBytes = multicodecBytes.subarray(bytesRead);
          if (keyBytes.length === 33) {
            const ec = new EC('secp256k1');
            const keyPoint = ec.keyFromPublic(keyBytes).getPublic();
            publicKeyBytes = fromString(keyPoint.encode('hex', false), 'hex');
          } else if (keyBytes.length === 65 && keyBytes[0] === 0x04) {
            publicKeyBytes = keyBytes;
          } else {
            throw new Error('Invalid ES256K public key format');
          }
        } else {
          throw new Error('No supported key format found for ES256K');
        }

        const verified = verifyEs256kSig(publicKeyBytes, signingInput, signature);
        if (!verified) {
          throw new Error('ES256K signature verification failed');
        }

      } else if (header.alg === 'ES256') {
        // Use jose for ES256, which is well-supported
        const getKey = async () => {
          if (method.publicKeyJwk) {
            return jose.importJWK(method.publicKeyJwk, 'ES256');
          }
          if (method.publicKeyMultibase) {
            const multicodecBytes = base58btc.decode(method.publicKeyMultibase);
            const [codec, bytesRead] = varint.decode(multicodecBytes);
            if (codec !== 0x1200) throw new Error('Key is not ES256');

            const keyBytes = multicodecBytes.subarray(bytesRead);
            let x: Uint8Array, y: Uint8Array;
            if (keyBytes.length === 65 && keyBytes[0] === 0x04) {
                x = keyBytes.subarray(1, 33);
                y = keyBytes.subarray(33, 65);
            } else if (keyBytes.length === 33) {
                const ec = new EC('p256');
                const keyPoint = ec.keyFromPublic(keyBytes).getPublic();
                x = keyPoint.getX().toBuffer('be', 32);
                y = keyPoint.getY().toBuffer('be', 32);
            } else {
                throw new Error('Invalid ES256 public key format');
            }
            const jwk = { kty: 'EC', crv: 'P-256', x: toString(x, 'base64url'), y: toString(y, 'base64url') };
            return jose.importJWK(jwk, 'ES256');
          }
          throw new Error('No supported key format found for ES256');
        };
        await jose.jwtVerify(token, getKey);
      } else {
        throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
      }

      console.log(`[AUTH] ✓ Signature verified for DID: ${signingDid}`);
      return true;
    } catch (error) {
      console.error(
        `[AUTH] Signature verification failed for DID ${signingDid}:`,
        error,
      );
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

/**
 * Validates a session by its ID, refreshing the PDS access token if it has expired.
 * This is a centralized function to be used by all authenticated routes/middleware.
 * @returns The updated session object, or null if the session is invalid.
 */
export async function validateAndRefreshSession(sessionId: string) {
  const { storage } = await import("../storage");
  let session = await storage.getSession(sessionId);

  if (!session) {
    return null; // Session not found in the database
  }

  const now = new Date();
  if (now > new Date(session.expiresAt)) {
    if (session.refreshToken) {
      console.log(`[AUTH] Access token expired for ${session.userDid}, attempting refresh...`);
      
      const { pdsClient } = await import("./pds-client");
      const { didResolver } = await import("./did-resolver");
      
      const pdsEndpoint = await didResolver.resolveDIDToPDS(session.userDid);
      if (pdsEndpoint) {
        const refreshResult = await pdsClient.refreshAccessToken(pdsEndpoint, session.refreshToken);
        
        if (refreshResult.success && refreshResult.data) {
          const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
          const updatedSessionData = {
            accessToken: refreshResult.data.accessJwt,
            refreshToken: refreshResult.data.refreshJwt || session.refreshToken,
            expiresAt: newExpiresAt,
          };

          session = await storage.updateSession(sessionId, updatedSessionData);
          if (session) {
            console.log(`[AUTH] Successfully refreshed and updated session for ${session.userDid}`);
            return session;
          }
        }
      }
      
      // If refresh fails for any reason, delete the invalid session
      await storage.deleteSession(sessionId);
      return null;
    } else {
      // No refresh token, so the session is permanently expired
      await storage.deleteSession(sessionId);
      return null;
    }
  }

  // Session is valid and not expired
  return session;
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

  // Use the centralized session validation and refresh logic
  const session = await validateAndRefreshSession(payload.sessionId);
  if (!session) {
    return res.status(401).json({ error: "Session not found or has expired" });
  }

  req.session = payload; // Attach original payload with DID and sessionID to the request
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
