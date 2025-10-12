import rateLimit from 'express-rate-limit';

/**
 * Configurable Rate Limiting for AT Protocol AppView
 * 
 * Protects against:
 * - Brute force attacks on authentication
 * - API abuse and DoS attacks
 * - Resource exhaustion (database, CPU)
 * - Unlimited password guessing
 * - Search API spam
 * 
 * Configuration via environment variables:
 * - RATE_LIMIT_ENABLED=false to disable all rate limiting (default: true)
 * - RATE_LIMIT_AUTH_MAX=5 (default: 5 per 15 minutes)
 * - RATE_LIMIT_OAUTH_MAX=10 (default: 10 per 15 minutes)
 * - RATE_LIMIT_WRITE_MAX=30 (default: 30 per minute)
 * - RATE_LIMIT_API_MAX=300 (default: 300 per minute - raised from 100)
 * - RATE_LIMIT_XRPC_MAX=300 (default: 300 per minute - raised from 100)
 * - RATE_LIMIT_SEARCH_MAX=60 (default: 60 per minute)
 * - RATE_LIMIT_ADMIN_MAX=30 (default: 30 per 5 minutes)
 * - RATE_LIMIT_DELETE_MAX=5 (default: 5 per hour)
 * - RATE_LIMIT_VITE_MAX=100 (default: 100 per minute - dev server)
 */

// Check if rate limiting is enabled (default: true)
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';

// Helper to create a no-op limiter when disabled
const noopLimiter = (_req: any, _res: any, next: any) => next();

// Parse environment variable with fallback
const parseLimit = (envVar: string | undefined, defaultValue: number): number => {
  const parsed = parseInt(envVar || '');
  return !isNaN(parsed) && parsed > 0 ? parsed : defaultValue;
};

// Authentication endpoints - Very strict (prevents brute force)
export const authLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseLimit(process.env.RATE_LIMIT_AUTH_MAX, 5),
  message: {
    error: 'Too many authentication attempts from this IP, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// OAuth endpoints - Moderate (allows callback attempts)
export const oauthLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseLimit(process.env.RATE_LIMIT_OAUTH_MAX, 10),
  message: {
    error: 'Too many OAuth requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// Write operations - Moderate (prevents spam)
export const writeLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseLimit(process.env.RATE_LIMIT_WRITE_MAX, 30),
  message: {
    error: 'Too many write requests, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// Search/typeahead - Lenient (allows typing)
export const searchLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseLimit(process.env.RATE_LIMIT_SEARCH_MAX, 60),
  message: {
    error: 'Too many search requests, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// General API - Raised to 300/min (was 100) for better client compatibility
export const apiLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseLimit(process.env.RATE_LIMIT_API_MAX, 300), // Raised from 100
  message: {
    error: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// XRPC endpoints - Raised to 300/min (was 100) for better client compatibility
export const xrpcLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseLimit(process.env.RATE_LIMIT_XRPC_MAX, 300), // Raised from 100
  message: {
    error: 'Too many XRPC requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// Admin endpoints - Very strict
export const adminLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: parseLimit(process.env.RATE_LIMIT_ADMIN_MAX, 30),
  message: {
    error: 'Too many admin requests, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// Data deletion - Extremely strict (critical operation)
export const deletionLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: parseLimit(process.env.RATE_LIMIT_DELETE_MAX, 5),
  message: {
    error: 'Too many deletion requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;

// Vite dev server - Moderate rate limiting for file system operations
export const viteLimiter = RATE_LIMIT_ENABLED ? rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseLimit(process.env.RATE_LIMIT_VITE_MAX, 100),
  message: {
    error: 'Too many development server requests, please slow down'
  },
  standardHeaders: true,
  legacyHeaders: false,
}) : noopLimiter;
