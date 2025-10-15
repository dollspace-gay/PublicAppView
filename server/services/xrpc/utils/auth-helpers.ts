/**
 * Authentication Utilities
 * Handles authentication, token verification, and session management
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { authService, validateAndRefreshSession } from '../../auth';

/**
 * Get user session for PDS communication by DID
 */
export async function getUserSessionForDid(userDid: string): Promise<unknown> {
  // Get all sessions for the user
  const sessions = await storage.getUserSessions(userDid);
  for (const session of sessions) {
    // Validate and refresh session if needed
    const validatedSession = await validateAndRefreshSession(session.id);
    if (validatedSession) {
      return validatedSession;
    }
  }
  return null;
}

/**
 * Extract authenticated user DID from request
 * Returns null if no valid authentication token is present
 * Supports both local session tokens and AT Protocol access tokens
 */
export async function getAuthenticatedDid(
  req: Request
): Promise<string | null> {
  try {
    const token = authService.extractToken(req);
    if (!token) {
      console.log(`[AUTH] No token found in request to ${req.path}`);
      return null;
    }

    const payload = await authService.verifyToken(token);
    if (!payload?.did) {
      console.log(`[AUTH] Token payload missing DID for ${req.path}`);
      return null;
    }
    // Enforce minimal audience/method checks if present
    // Skip for app password tokens (they're pre-validated by PDS)
    try {
      const anyPayload: {
        aud?: string;
        scope?: string;
        lxm?: string;
        did: string;
      } = payload as {
        aud?: string;
        scope?: string;
        lxm?: string;
        did: string;
      };
      const appviewDid = process.env.APPVIEW_DID;
      if (!appviewDid) {
        console.error('[AUTH] APPVIEW_DID not configured');
        return null;
      }
      const nsid = req.path.startsWith('/xrpc/')
        ? req.path.slice('/xrpc/'.length)
        : undefined;

      // Skip aud check for app password tokens (scope=com.atproto.appPassPrivileged)
      const isAppPassword =
        anyPayload.scope === 'com.atproto.appPassPrivileged';
      if (!isAppPassword && anyPayload.aud) {
        // Accept both base AppView DID and service-specific DID (with #bsky_appview fragment)
        const isBaseAppViewDid = anyPayload.aud === appviewDid;
        const isServiceAppViewDid =
          anyPayload.aud === `${appviewDid}#bsky_appview`;

        if (!isBaseAppViewDid && !isServiceAppViewDid) {
          console.warn(
            `[AUTH] aud mismatch. expected=${appviewDid} or ${appviewDid}#bsky_appview got=${anyPayload.aud}`
          );
          return null;
        }
      }
      if (anyPayload.lxm && nsid && anyPayload.lxm !== nsid) {
        console.warn(
          `[AUTH] lxm mismatch. expected=${nsid} got=${anyPayload.lxm}`
        );
        return null;
      }
    } catch {
      // Ignore JWT parsing errors - will return null below
    }

    return payload.did;
  } catch (error) {
    // Token verification failed (malformed, expired, etc.)
    console.error(
      '[AUTH] Token verification failed for path:',
      { path: req.path },
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Require authentication and return user DID
 * Sends 401 error response if not authenticated
 */
export async function requireAuthDid(
  req: Request,
  res: Response
): Promise<string | null> {
  const did = await getAuthenticatedDid(req);
  if (!did) {
    console.log(`[AUTH] Authentication required but missing for ${req.path}`);
    res.status(401).json({
      error: 'AuthMissing',
      message: 'Authentication Required',
    });
    return null;
  }
  return did;
}
