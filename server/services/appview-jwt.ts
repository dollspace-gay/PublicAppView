/**
 * AppView JWT Service
 * 
 * Signs JWTs for feed generator requests to authenticate the AppView service
 * Follows AT Protocol JWT specification for service-to-service authentication
 */

import jwt from "jsonwebtoken";
import fs from "fs";
import { fromString, toString } from 'uint8arrays';
import KeyEncoder from 'key-encoder';
import elliptic from 'elliptic';

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const JWT_SECRET = process.env.SESSION_SECRET;
const PRIVATE_KEY_PATH = process.env.APPVIEW_PRIVATE_KEY_PATH || "/app/appview-private.pem";

/**
 * Sign data using ES256K (secp256k1) algorithm
 * This is required because jsonwebtoken library doesn't support ES256K
 */
const signES256K = (privateKeyPem: string, data: string): string => {
  try {
    // The `key-encoder` library is a CJS module that, when bundled,
    // might be wrapped in a default object. This handles that case
    // by checking for a `default` property and using it if it exists.
    const KeyEncoderClass = (KeyEncoder as any).default || KeyEncoder;
    const keyEncoder = new KeyEncoderClass('secp256k1');
    
    // Convert PEM to raw key format
    const rawKey = keyEncoder.encodePrivate(privateKeyPem, 'pem', 'raw');
    
    // Create secp256k1 curve instance
    const ec = new elliptic.ec('secp256k1');
    
    // Create key pair from private key
    const keyPair = ec.keyFromPrivate(rawKey);
    
    // Sign the data
    const signature = keyPair.sign(data, {
      canonical: true,
      pers: undefined
    });
    
    // Convert to IEEE P1363 format (r || s) and then to base64url
    const r = signature.r.toString('hex').padStart(64, '0');
    const s = signature.s.toString('hex').padStart(64, '0');
    const signatureHex = r + s;
    const signatureBytes = fromString(signatureHex, 'hex');
    
    // Convert to base64url encoding for JWT
    return toString(signatureBytes, 'base64url');
  } catch (error) {
    console.error('[AppViewJWT] ES256K signing failed:', error);
    throw new Error('ES256K signing failed');
  }
};

/**
 * Create a JWT token with custom ES256K signing
 * This bypasses the jsonwebtoken library's algorithm validation
 */
const createJWTWithES256K = (payload: any, privateKeyPem: string, keyid: string): string => {
  try {
    // Create JWT header
    const header = {
      alg: 'ES256K',
      typ: 'JWT',
      kid: keyid
    };
    
    // Encode header and payload
    const headerB64 = toString(fromString(JSON.stringify(header)), 'base64url');
    const payloadB64 = toString(fromString(JSON.stringify(payload)), 'base64url');
    
    // Create signing input
    const signingInput = `${headerB64}.${payloadB64}`;
    
    // Sign with ES256K
    const signature = signES256K(privateKeyPem, signingInput);
    
    // Return complete JWT
    return `${signingInput}.${signature}`;
  } catch (error) {
    console.error('[AppViewJWT] Custom JWT creation failed:', error);
    throw new Error('JWT creation failed');
  }
};

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
      return createJWTWithES256K(payload, this.privateKeyPem, "atproto");
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
      return createJWTWithES256K(payload, this.privateKeyPem, "atproto");
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
