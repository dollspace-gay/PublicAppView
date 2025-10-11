import { randomBytes, createHmac } from "crypto";
import type { Request, Response, NextFunction } from "express";

// Require SESSION_SECRET to be set for CSRF protection
if (!process.env.SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET environment variable is required for CSRF protection. " +
    "Generate a secure secret with: openssl rand -hex 32"
  );
}

const CSRF_SECRET = process.env.SESSION_SECRET;
const CSRF_TOKEN_LENGTH = 32;

/**
 * Modern CSRF Protection using Double-Submit Cookie Pattern
 * 
 * This implementation:
 * - Generates cryptographically secure tokens
 * - Uses HMAC for token validation
 * - Implements double-submit cookie pattern
 * - Works with both cookie and header-based tokens
 */

export class CSRFProtection {
  /**
   * Generate a new CSRF token
   */
  generateToken(): string {
    return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  }

  /**
   * Create HMAC signature for token validation
   */
  signToken(token: string): string {
    return createHmac('sha256', CSRF_SECRET)
      .update(token)
      .digest('hex');
  }

  /**
   * Verify CSRF token matches signature
   */
  verifyToken(token: string, signature: string): boolean {
    const expectedSignature = this.signToken(token);
    
    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    
    return result === 0;
  }

  /**
   * Middleware to generate and set CSRF token cookie
   */
  setToken = (req: Request, res: Response, next: NextFunction) => {
    // Generate token if not present
    if (!req.cookies?.csrf_token) {
      const token = this.generateToken();
      const signature = this.signToken(token);
      
      // Set double-submit cookies (token + signature)
      res.cookie('csrf_token', token, {
        httpOnly: false, // Must be accessible to JavaScript
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // Match session cookie policy
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/' // Ensure cookie is available for all paths
      });
      
      res.cookie('csrf_signature', signature, {
        httpOnly: true, // Signature is HTTP-only for security
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // Match session cookie policy
        maxAge: 24 * 60 * 60 * 1000,
        path: '/' // Ensure cookie is available for all paths
      });
    }
    
    next();
  };

  /**
   * Middleware to validate CSRF token on state-changing requests
   */
  validateToken = (req: Request, res: Response, next: NextFunction) => {
    // Skip validation for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    // Extract token from header or body
    const tokenFromHeader = req.headers['x-csrf-token'] as string;
    const tokenFromBody = req.body?.csrfToken;
    const submittedToken = tokenFromHeader || tokenFromBody;

    // Extract token and signature from cookies
    const cookieToken = req.cookies?.csrf_token;
    const cookieSignature = req.cookies?.csrf_signature;

    // Debug logging
    console.log(`[CSRF] Validating ${req.method} ${req.path}`, {
      hasHeaderToken: !!tokenFromHeader,
      hasBodyToken: !!tokenFromBody,
      hasCookieToken: !!cookieToken,
      hasCookieSignature: !!cookieSignature,
      userAgent: req.headers['user-agent']?.substring(0, 50),
      origin: req.headers['origin'],
      referer: req.headers['referer']
    });

    // Validation checks
    if (!submittedToken) {
      console.warn(`[CSRF] Missing token from ${req.method} ${req.path}`, {
        headers: Object.keys(req.headers).filter(h => h.toLowerCase().includes('csrf')),
        bodyKeys: Object.keys(req.body || {}),
        cookies: Object.keys(req.cookies || {})
      });
      return res.status(403).json({ 
        error: 'CSRF token missing',
        message: 'CSRF token required in X-CSRF-Token header or request body'
      });
    }

    if (!cookieToken || !cookieSignature) {
      console.warn(`[CSRF] Missing cookies from ${req.method} ${req.path}`, {
        availableCookies: Object.keys(req.cookies || {}),
        cookieToken: !!cookieToken,
        cookieSignature: !!cookieSignature
      });
      return res.status(403).json({ 
        error: 'CSRF validation failed',
        message: 'CSRF cookies missing'
      });
    }

    // Verify token matches cookie
    if (submittedToken !== cookieToken) {
      console.warn(`[CSRF] Token mismatch from ${req.method} ${req.path}`, {
        submittedLength: submittedToken?.length,
        cookieLength: cookieToken?.length,
        tokensMatch: submittedToken === cookieToken
      });
      return res.status(403).json({ 
        error: 'CSRF validation failed',
        message: 'CSRF token mismatch'
      });
    }

    // Verify HMAC signature
    if (!this.verifyToken(cookieToken, cookieSignature)) {
      console.warn(`[CSRF] Invalid signature from ${req.method} ${req.path}`, {
        tokenLength: cookieToken?.length,
        signatureLength: cookieSignature?.length,
        expectedSignature: this.signToken(cookieToken).substring(0, 8) + '...',
        actualSignature: cookieSignature?.substring(0, 8) + '...'
      });
      return res.status(403).json({ 
        error: 'CSRF validation failed',
        message: 'CSRF token signature invalid'
      });
    }

    console.log(`[CSRF] ✓ Valid token for ${req.method} ${req.path}`);
    next();
  };

  /**
   * Get current CSRF token for frontend
   */
  getTokenValue = (req: Request): string | null => {
    return req.cookies?.csrf_token || null;
  };
}

export const csrfProtection = new CSRFProtection();
