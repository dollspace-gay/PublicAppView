/**
 * AppView JWT Service
 * 
 * Signs JWTs for feed generator requests to authenticate the AppView service
 * Follows AT Protocol JWT specification for service-to-service authentication
 */

import jwt from "jsonwebtoken";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const JWT_SECRET = process.env.SESSION_SECRET;
const JWT_EXPIRY = "5m"; // Short-lived tokens for feed generator requests

export interface AppViewJWTPayload {
  iss: string; // Issuer: AppView DID
  aud: string; // Audience: Feed generator DID
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
}

export class AppViewJWTService {
  private appViewDid: string;

  constructor() {
    this.appViewDid = process.env.APPVIEW_DID || "did:web:appview.local";
    
    if (!process.env.APPVIEW_DID) {
      console.warn(
        "[AppViewJWT] APPVIEW_DID not set, using default 'did:web:appview.local'. " +
        "Set APPVIEW_DID environment variable for production use."
      );
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

    return jwt.sign(payload, JWT_SECRET, { 
      algorithm: "HS256",
      expiresIn: JWT_EXPIRY,
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
