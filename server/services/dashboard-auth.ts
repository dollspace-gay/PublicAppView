/**
 * Dashboard Authentication Service
 * 
 * Simple password-based authentication for dashboard access
 * Separate from AT Protocol OAuth to protect admin configuration
 */

import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const JWT_SECRET = process.env.SESSION_SECRET;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "";
const JWT_EXPIRY = "24h"; // Dashboard sessions last 24 hours

if (!DASHBOARD_PASSWORD) {
  console.warn(
    "[DashboardAuth] WARNING: DASHBOARD_PASSWORD not set! Dashboard is publicly accessible. " +
    "Set DASHBOARD_PASSWORD environment variable to secure your dashboard."
  );
}

export interface DashboardSessionPayload {
  type: "dashboard";
  sessionId: string;
  createdAt: number;
}

export class DashboardAuthService {
  /**
   * Verify dashboard password using bcrypt (with backwards compatibility for plain passwords)
   * 
   * SECURITY: This method supports two modes:
   * 1. Bcrypt hash (recommended): DASHBOARD_PASSWORD starts with $2a$, $2b$, or $2y$
   * 2. Plain password (legacy, INSECURE): For backwards compatibility only
   * 
   * Migration guide:
   * 1. Generate bcrypt hash: node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10, (e,h) => console.log(h));"
   * 2. Update DASHBOARD_PASSWORD in .env with the hash
   * 3. Restart the server
   */
  async verifyPassword(password: string): Promise<boolean> {
    if (!DASHBOARD_PASSWORD) {
      return false;
    }
    
    try {
      // Check if DASHBOARD_PASSWORD is a bcrypt hash (starts with $2a$, $2b$, or $2y$)
      if (DASHBOARD_PASSWORD.startsWith('$2')) {
        // Use bcrypt comparison for hashed passwords
        return await bcrypt.compare(password, DASHBOARD_PASSWORD);
      }
      
      // LEGACY MODE: Plain password comparison (NOT RECOMMENDED - for backwards compatibility only)
      console.warn('[DashboardAuth] SECURITY WARNING: Using plain password comparison. ' +
                   'Please upgrade to bcrypt hash. See dashboard-auth.ts for migration guide.');
      return password === DASHBOARD_PASSWORD;
    } catch (error) {
      console.error('[DashboardAuth] Password verification error:', error);
      return false;
    }
  }

  /**
   * Create a dashboard session token
   */
  createDashboardToken(): string {
    const sessionId = randomBytes(32).toString("hex");
    
    const payload: DashboardSessionPayload = {
      type: "dashboard",
      sessionId,
      createdAt: Date.now(),
    };

    return jwt.sign(payload, JWT_SECRET, { 
      algorithm: "HS256",
      expiresIn: JWT_EXPIRY,
    });
  }

  /**
   * Verify a dashboard token
   */
  verifyDashboardToken(token: string): DashboardSessionPayload | null {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as DashboardSessionPayload;
      
      if (payload.type !== "dashboard") {
        return null;
      }
      
      return payload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract token from request
   */
  extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    
    const cookieToken = req.headers.cookie
      ?.split(";")
      .find(c => c.trim().startsWith("dashboard_token="))
      ?.split("=")[1];
    
    return cookieToken || null;
  }

  /**
   * Check if dashboard authentication is required
   */
  isAuthRequired(): boolean {
    return !!DASHBOARD_PASSWORD;
  }
}

export const dashboardAuthService = new DashboardAuthService();

export interface DashboardAuthRequest extends Request {
  dashboardSession?: DashboardSessionPayload;
}

/**
 * Middleware to require dashboard authentication
 */
export async function requireDashboardAuth(
  req: DashboardAuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!dashboardAuthService.isAuthRequired()) {
    console.warn("[DashboardAuth] Dashboard password not set - allowing access");
    next();
    return;
  }

  const token = dashboardAuthService.extractToken(req);
  
  if (!token) {
    return res.status(401).json({ 
      error: "Dashboard authentication required",
      authRequired: true,
    });
  }

  const payload = dashboardAuthService.verifyDashboardToken(token);
  
  if (!payload) {
    return res.status(401).json({ 
      error: "Invalid or expired dashboard token",
      authRequired: true,
    });
  }

  req.dashboardSession = payload;
  next();
}
