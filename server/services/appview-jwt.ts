/**
 * AppView JWT Service
 *
 * Handles JWT operations for the AppView service according to AT Protocol specification.
 * The AppView signs JWTs for feed generator requests and verifies user-signed JWTs from PDS.
 */

import jwt from 'jsonwebtoken';
import fs from 'fs';
import { fromString, toString, concat } from 'uint8arrays';
import KeyEncoder from 'key-encoder';
import elliptic from 'elliptic';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required');
}

const JWT_SECRET = process.env.SESSION_SECRET;
const PRIVATE_KEY_PATH =
  process.env.APPVIEW_PRIVATE_KEY_PATH || '/app/appview-private.pem';

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
      pers: undefined,
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
const createJWTWithES256K = (
  payload: any,
  privateKeyPem: string,
  keyid: string
): string => {
  try {
    // Create JWT header
    const header = {
      alg: 'ES256K',
      typ: 'JWT',
      kid: keyid,
    };

    // Encode header and payload
    const headerB64 = toString(fromString(JSON.stringify(header)), 'base64url');
    const payloadB64 = toString(
      fromString(JSON.stringify(payload)),
      'base64url'
    );

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

export interface UserSignedJWTPayload {
  iss: string; // Issuer: User's DID
  aud: string; // Audience: AppView DID
  sub: string; // Subject: User's DID
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
  lxm?: string; // Lexicon method (e.g., app.bsky.actor.getPreferences)
  jti?: string; // JWT ID (nonce)
}

export class AppViewJWTService {
  private appViewDid: string;
  private privateKeyPem: string | null;
  private signingAlg: 'ES256K' | 'HS256';

  constructor() {
    this.appViewDid = process.env.APPVIEW_DID || '';
    this.privateKeyPem = null;
    this.signingAlg = 'ES256K';

    if (!this.appViewDid) {
      throw new Error(
        '[AppViewJWT] APPVIEW_DID environment variable is required. ' +
          "Set APPVIEW_DID to your AppView's DID (e.g., did:web:appview.yourdomain.com)."
      );
    }

    // Prefer ES256K with a mounted private key PEM when available.
    try {
      if (fs.existsSync(PRIVATE_KEY_PATH)) {
        const pem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8').trim();
        if (
          pem.includes('BEGIN EC PRIVATE KEY') ||
          pem.includes('BEGIN PRIVATE KEY')
        ) {
          this.privateKeyPem = pem;
          this.signingAlg = 'ES256K';
          console.log(
            `[AppViewJWT] Loaded ES256K private key from ${PRIVATE_KEY_PATH}`
          );
        } else {
          console.warn(
            `[AppViewJWT] File at ${PRIVATE_KEY_PATH} does not look like a PEM private key; falling back to HS256.`
          );
        }
      } else {
        console.warn(
          `[AppViewJWT] Private key PEM not found at ${PRIVATE_KEY_PATH}; using HS256 with SESSION_SECRET.`
        );
      }
    } catch (err) {
      console.warn(
        `[AppViewJWT] Failed to initialize ES256K key from ${PRIVATE_KEY_PATH}; falling back to HS256:`,
        err
      );
    }
  }

  /**
   * Sign a JWT for feed generator requests (AppView to Feed Generator)
   * This is the ONLY case where the AppView signs its own tokens
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
      return createJWTWithES256K(payload, this.privateKeyPem, 'atproto');
    }

    // Fallback to HS256 only if no private key available
    console.warn(
      '[AppViewJWT] No private key available, using HS256 fallback for feed generator token.'
    );
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      keyid: 'atproto',
    });
  }

  /**
   * Verify a user-signed JWT token from PDS
   * This is the primary use case - verifying tokens signed by users' PDS
   * @param token - The JWT token to verify
   * @param expectedMethod - The expected lexicon method (e.g., app.bsky.actor.getPreferences)
   * @returns Decoded payload if valid, null if invalid
   */
  async verifyUserSignedToken(
    token: string,
    expectedMethod?: string
  ): Promise<UserSignedJWTPayload | null> {
    try {
      // Decode without verification to check token structure
      const decoded = jwt.decode(token, { complete: true }) as any;

      if (!decoded || !decoded.payload) {
        console.log('[AppViewJWT] Failed to decode user-signed token');
        return null;
      }

      const payload = decoded.payload as UserSignedJWTPayload;

      // Validate required fields
      if (!payload.iss || !payload.aud || !payload.sub) {
        console.log('[AppViewJWT] User-signed token missing required fields');
        return null;
      }

      // Check audience matches this AppView
      if (payload.aud !== this.appViewDid) {
        console.log(
          `[AppViewJWT] Token audience mismatch: expected ${this.appViewDid}, got ${payload.aud}`
        );
        return null;
      }

      // Check subject matches issuer (user signing for themselves)
      if (payload.sub !== payload.iss) {
        console.log(
          `[AppViewJWT] Token subject mismatch: expected ${payload.iss}, got ${payload.sub}`
        );
        return null;
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        console.log('[AppViewJWT] User-signed token has expired');
        return null;
      }

      // Check method if specified
      if (expectedMethod && payload.lxm && payload.lxm !== expectedMethod) {
        console.log(
          `[AppViewJWT] Token method mismatch: expected ${expectedMethod}, got ${payload.lxm}`
        );
        return null;
      }

      // Verify signature using user's public key
      const verified = await this.verifyJWTSignature(token, payload.iss);

      if (!verified) {
        console.error(
          `[AppViewJWT] Signature verification failed for user DID: ${payload.iss}`
        );
        return null;
      }

      console.log(
        `[AppViewJWT] ✓ User-signed token verified for DID: ${payload.iss}`
      );
      return payload;
    } catch (error) {
      console.error(
        '[AppViewJWT] User-signed token verification failed:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Verify JWT signature using the signer's public key from their DID document
   */
  private async verifyJWTSignature(
    token: string,
    signerDid: string
  ): Promise<boolean> {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split('.');
      if (!headerB64 || !payloadB64 || !signatureB64) {
        throw new Error('Invalid JWT structure');
      }

      const header = JSON.parse(
        toString(fromString(headerB64, 'base64url'))
      ) as any;

      const { didResolver } = await import('./did-resolver');
      const didDocument = await didResolver.resolveDID(signerDid);

      if (!didDocument || !didDocument.verificationMethod) {
        console.error(
          `[AppViewJWT] No verification methods found for DID: ${signerDid}`
        );
        return false;
      }

      const { kid } = header;
      const verificationMethods = didDocument.verificationMethod || [];

      let method;

      if (kid) {
        method = verificationMethods.find(
          (m) => m.id.endsWith(`#${kid}`) || m.id === kid
        );
      } else {
        const atprotoKeys = verificationMethods.filter((m) =>
          m.id.endsWith('#atproto')
        );
        if (atprotoKeys.length === 1) {
          console.log(
            `[AppViewJWT] JWT missing 'kid', using unique #atproto key for DID ${signerDid}`
          );
          method = atprotoKeys[0];
        } else {
          throw new Error(
            "JWT missing 'kid' and could not find a unique '#atproto' verification key."
          );
        }
      }

      if (!method) {
        throw new Error(`No verification method found for kid: ${kid}`);
      }

      // Handle different key formats and algorithms
      if (header.alg === 'ES256K') {
        return this.verifyES256KSignature(
          method,
          headerB64,
          payloadB64,
          signatureB64
        );
      } else if (header.alg === 'ES256') {
        return this.verifyES256Signature(method, token);
      } else {
        throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
      }
    } catch (error) {
      console.error(
        `[AppViewJWT] Signature verification failed for DID ${signerDid}:`,
        error
      );
      return false;
    }
  }

  private verifyES256KSignature(
    method: any,
    headerB64: string,
    payloadB64: string,
    signatureB64: string
  ): boolean {
    try {
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
        const { base58btc } = require('multiformats/bases/base58');
        const { varint } = require('multiformats');
        const multicodecBytes = base58btc.decode(method.publicKeyMultibase);
        const [codec, bytesRead] = varint.decode(multicodecBytes);
        if (codec !== 0xe7) throw new Error('Key is not ES256K');

        const keyBytes = multicodecBytes.subarray(bytesRead);
        if (keyBytes.length === 33) {
          const ec = new elliptic.ec('secp256k1');
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

      // Verify the signature using secp256k1
      const KeyEncoderClass = (KeyEncoder as any).default || KeyEncoder;
      const keyEncoder = new KeyEncoderClass('secp256k1');
      const pemKey = keyEncoder.encodePublic(
        toString(publicKeyBytes, 'hex'),
        'raw',
        'pem'
      );

      const { createPublicKey, verify } = require('crypto');
      const key = createPublicKey({ format: 'pem', key: pemKey });

      const verified = verify(
        'sha256',
        signingInput,
        {
          key,
          dsaEncoding: 'ieee-p1363',
        },
        signature
      );

      if (!verified) {
        throw new Error('ES256K signature verification failed');
      }

      return true;
    } catch (error) {
      console.error(
        '[AppViewJWT] ES256K signature verification failed:',
        error
      );
      return false;
    }
  }

  private async verifyES256Signature(
    method: any,
    token: string
  ): Promise<boolean> {
    try {
      const { base58btc } = require('multiformats/bases/base58');
      const { varint } = require('multiformats');
      const jose = require('jose');

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
            const ec = new elliptic.ec('p256');
            const keyPoint = ec.keyFromPublic(keyBytes).getPublic();
            x = keyPoint.getX().toBuffer('be', 32);
            y = keyPoint.getY().toBuffer('be', 32);
          } else {
            throw new Error('Invalid ES256 public key format');
          }
          const jwk = {
            kty: 'EC',
            crv: 'P-256',
            x: toString(x, 'base64url'),
            y: toString(y, 'base64url'),
          };
          return jose.importJWK(jwk, 'ES256');
        }
        throw new Error('No supported key format found for ES256');
      };

      await jose.jwtVerify(token, getKey);
      return true;
    } catch (error) {
      console.error('[AppViewJWT] ES256 signature verification failed:', error);
      return false;
    }
  }

  /**
   * Get the AppView DID
   */
  getAppViewDid(): string {
    return this.appViewDid;
  }

  /**
   * Verify a JWT token (for testing/validation) - only for AppView-signed tokens
   */
  verifyToken(token: string): AppViewJWTPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AppViewJWTPayload;
      return payload;
    } catch (error) {
      console.error('[AppViewJWT] Token verification failed:', error);
      return null;
    }
  }
}

export const appViewJWTService = new AppViewJWTService();
