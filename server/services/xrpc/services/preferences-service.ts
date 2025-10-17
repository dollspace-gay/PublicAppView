/**
 * Preferences Service
 *
 * NOTE: Per ATProto architecture, preferences are user-specific private data
 * that belongs on the PDS, NOT the AppView. AppViews aggregate public data only.
 *
 * These endpoints proxy requests back to the user's PDS for compatibility
 * with clients that expect the AppView to handle all XRPC calls.
 */

import type { Request, Response } from 'express';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { getUserPdsEndpoint } from '../utils/resolvers';
import { pdsClient } from '../../pds-client';

/**
 * Get user preferences
 * GET /xrpc/app.bsky.actor.getPreferences
 *
 * Proxies request to user's PDS
 */
export async function getPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    console.log(
      `[PREFERENCES] GET request for ${userDid} - proxying to PDS`
    );

    // Get user's PDS endpoint
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    if (!pdsEndpoint) {
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Could not resolve PDS endpoint for user',
      });
    }

    // Extract authorization token from request
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        error: 'AuthRequired',
        message: 'Authorization header required',
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Proxy the request to the PDS
    const pdsResponse = await pdsClient.proxyXRPC(
      pdsEndpoint,
      'GET',
      '/xrpc/app.bsky.actor.getPreferences',
      req.query,
      token,
      undefined,
      req.headers
    );

    // Forward the PDS response to the client
    res.status(pdsResponse.status).json(pdsResponse.body);
  } catch (error) {
    console.error(`[PREFERENCES] Error in getPreferences:`, error);
    handleError(res, error, 'getPreferences');
  }
}

/**
 * Update user preferences
 * POST/PUT /xrpc/app.bsky.actor.putPreferences
 *
 * Proxies request to user's PDS
 */
export async function putPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    console.log(
      `[PREFERENCES] PUT request for ${userDid} - proxying to PDS`
    );

    // Get user's PDS endpoint
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    if (!pdsEndpoint) {
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Could not resolve PDS endpoint for user',
      });
    }

    // Extract authorization token from request
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        error: 'AuthRequired',
        message: 'Authorization header required',
      });
    }

    const token = authHeader.replace('Bearer ', '');

    // Proxy the request to the PDS
    const pdsResponse = await pdsClient.proxyXRPC(
      pdsEndpoint,
      req.method,
      '/xrpc/app.bsky.actor.putPreferences',
      req.query,
      token,
      req.body,
      req.headers
    );

    // Forward the PDS response to the client
    res.status(pdsResponse.status).json(pdsResponse.body);
  } catch (error) {
    console.error(`[PREFERENCES] Error in putPreferences:`, error);
    handleError(res, error, 'putPreferences');
  }
}
