/**
 * AppView JWT Service
 * 
 * Signs JWTs for feed generator requests to authenticate the AppView service
 * Follows AT Protocol JWT specification for service-to-service authentication
 */

import jwt from "jsonwebtoken";
import fs from "fs";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const JWT_SECRET = process.env.SESSION_SECRET;
const PRIVATE_KEY_PATH = process.env.APPVIEW_PRIVATE_KEY_PATH || "/app/appview-private.pem";

export interface AppViewJWTPayload {
  iss: string; // Issuer: AppView DID
  aud: string; // Audience: Feed generator DID
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
}

export class AppViewJWTService {
  private appViewDid: string;
  private privateKeyPem: string | null;
  private signingAlg: "ES256K" | "HS256";

  constructor() {
    this.appViewDid = process.env.APPVIEW_DID || "";
    this.privateKeyPem = null;
    this.signingAlg = "ES256K";
    
    if (!this.appViewDid) {
      throw new Error(
        "[AppViewJWT] APPVIEW_DID environment variable is required. " +
        "Set APPVIEW_DID to your AppView's DID (e.g., did:web:appview.yourdomain.com)."
      );
    }

    // Prefer ES256K with a mounted private key PEM when available.
    try {
      if (fs.existsSync(PRIVATE_KEY_PATH)) {
        const pem = fs.readFileSync(PRIVATE_KEY_PATH, "utf-8").trim();
        if (pem.includes("BEGIN EC PRIVATE KEY") || pem.includes("BEGIN PRIVATE KEY")) {
          this.privateKeyPem = pem;
          this.signingAlg = "ES256K";
          console.log(`[AppViewJWT] Loaded ES256K private key from ${PRIVATE_KEY_PATH}`);
        } else {
          console.warn(`[AppViewJWT] File at ${PRIVATE_KEY_PATH} does not look like a PEM private key; falling back to HS256.`);
        }
      } else {
        console.warn(`[AppViewJWT] Private key PEM not found at ${PRIVATE_KEY_PATH}; using HS256 with SESSION_SECRET.`);
      }
    } catch (err) {
      console.warn(`[AppViewJWT] Failed to initialize ES256K key from ${PRIVATE_KEY_PATH}; falling back to HS256:`, err);
    }
  }

  /**
   * Sign a JWT for a feed generator request
   * @param feedGeneratorDid - The DID of the feed generator service
   * @returns Signed JWT token
   */
  signFeedGeneratorToken(feedGeneratorDid: string): string {
    const now = Math.floor(Date.now() / 1000);
    
    const payload: AppViewJWTPayload = {
      iss: this.appViewDid,
      aud: feedGeneratorDid,
      exp: now + 300, // 5 minutes
      iat: now,
    };

    // Use ES256K with proper key ID for AT Protocol compatibility
    if (this.privateKeyPem) {
      return jwt.sign(payload, this.privateKeyPem, {
        algorithm: "ES256K",
        keyid: "atproto", // Must match the verification method ID fragment
      });
    }

    // Fallback to HS256 only if no private key available
    console.warn("[AppViewJWT] No private key available, using HS256 fallback. This may cause PDS authentication failures.");
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: "HS256",
      keyid: "atproto",
    });
  }

  /**
   * Sign a JWT for PDS authentication (server-to-server)
   * @param pdsDid - The DID of the PDS service
   * @param userDid - The DID of the user we're acting on behalf of
   * @returns Signed JWT token
   */
  signPDSToken(pdsDid: string, userDid: string): string {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      iss: this.appViewDid,
      aud: pdsDid,
      sub: userDid, // Acting on behalf of this user
      exp: now + 300, // 5 minutes
      iat: now,
    };

    // Use ES256K with proper key ID for AT Protocol compatibility
    if (this.privateKeyPem) {
      return jwt.sign(payload, this.privateKeyPem, {
        algorithm: "ES256K",
        keyid: "atproto", // Must match the verification method ID fragment
      });
    }

    // Fallback to HS256 only if no private key available
    console.warn("[AppViewJWT] No private key available, using HS256 fallback. This may cause PDS authentication failures.");
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: "HS256",
      keyid: "atproto",
    });
  }

  /**
   * Get the AppView DID
   */
  getAppViewDid(): string {
    return this.appViewDid;
  }

  /**
   * Verify a JWT token (for testing/validation)
   */
  verifyToken(token: string): AppViewJWTPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AppViewJWTPayload;
      return payload;
    } catch (error) {
      console.error("[AppViewJWT] Token verification failed:", error);
      return null;
    }
  }
}

export const appViewJWTService = new AppViewJWTService();
