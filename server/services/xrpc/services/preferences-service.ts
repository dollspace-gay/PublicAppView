/**
 * Preferences Service
 *
 * NOTE: Per ATProto architecture, preferences are user-specific private data
 * that belongs on the PDS, NOT the AppView. AppViews aggregate public data only.
 *
 * Clients should fetch preferences directly from the user's PDS using their
 * PDS token, then apply those preferences client-side to AppView feed data.
 *
 * These endpoints return helpful errors directing clients to the proper flow.
 */

import type { Request, Response } from 'express';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { getUserPdsEndpoint } from '../utils/resolvers';

/**
 * Get user preferences
 * GET /xrpc/app.bsky.actor.getPreferences
 *
 * Returns error directing client to fetch from PDS directly
 */
export async function getPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Use debug-level logging to reduce log volume
    if (process.env.DEBUG_LOGGING === 'true') {
      console.log(
        `[PREFERENCES] GET request for ${userDid} - directing to PDS`
      );
    }

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message:
        'Preferences must be fetched directly from your PDS, not through the AppView. ' +
        'Per ATProto architecture, preferences are private user data stored on the PDS. ' +
        (pdsEndpoint
          ? `Please fetch from: ${pdsEndpoint}/xrpc/app.bsky.actor.getPreferences`
          : 'Please fetch from your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    console.error(`[PREFERENCES] Error in getPreferences:`, error);
    handleError(res, error, 'getPreferences');
  }
}

/**
 * Update user preferences
 * POST /xrpc/app.bsky.actor.putPreferences
 *
 * Returns error directing client to update on PDS directly
 */
export async function putPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Use debug-level logging to reduce log volume
    if (process.env.DEBUG_LOGGING === 'true') {
      console.log(
        `[PREFERENCES] PUT request for ${userDid} - directing to PDS`
      );
    }

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message:
        'Preferences must be updated directly on your PDS, not through the AppView. ' +
        'Per ATProto architecture, preferences are private user data stored on the PDS. ' +
        (pdsEndpoint
          ? `Please update at: ${pdsEndpoint}/xrpc/app.bsky.actor.putPreferences`
          : 'Please update on your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    console.error(`[PREFERENCES] Error in putPreferences:`, error);
    handleError(res, error, 'putPreferences');
  }
}
