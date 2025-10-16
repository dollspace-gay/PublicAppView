/**
 * Preferences Service
 * Handles user preferences (get and update)
 */

import type { Request, Response } from 'express';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { getUserPdsEndpoint } from '../utils/resolvers';
import { cacheManager } from '../utils/cache';
import { putActorPreferencesSchema } from '../schemas';

/**
 * Get user preferences
 * GET /xrpc/app.bsky.actor.getPreferences
 */
export async function getPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Get authenticated user DID using OAuth token verification
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Check cache first
    const cached = cacheManager.getPreferences(userDid);
    if (cached) {
      console.log(`[PREFERENCES] Cache hit for ${userDid}`);
      return res.json({ preferences: cached });
    }

    // Cache miss - fetch from user's PDS
    console.log(`[PREFERENCES] Cache miss for ${userDid}, fetching from PDS`);

    try {
      // Get user's PDS endpoint from DID document
      const pdsEndpoint = await getUserPdsEndpoint(userDid);
      if (!pdsEndpoint) {
        console.log(
          `[PREFERENCES] No PDS endpoint found for ${userDid}, returning empty preferences`
        );
        return res.json({ preferences: [] });
      }

      // Extract the token from the request - for third-party clients (Bluesky app),
      // they send the PDS token directly. For web UI users, try to get from session.
      const authHeader = req.headers.authorization;
      let pdsToken: string | undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        // Client is already sending a PDS token (app password or OAuth token)
        pdsToken = authHeader.substring(7);
      } else {
        // Fallback: try to get PDS token from session (for web UI users)
        const { storage } = await import('../../../storage');
        const session = await storage.getSession(userDid);
        if (session?.accessToken) {
          pdsToken = session.accessToken;
        }
      }

      if (!pdsToken) {
        console.warn(
          `[PREFERENCES] No PDS token found for ${userDid}, returning empty preferences`
        );
        return res.json({ preferences: [] });
      }

      // Forward request to user's PDS with their PDS token
      const pdsResponse = await fetch(
        `${pdsEndpoint}/xrpc/app.bsky.actor.getPreferences`,
        {
          headers: {
            Authorization: `Bearer ${pdsToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (pdsResponse.ok) {
        const pdsData = (await pdsResponse.json()) as {
          preferences?: unknown[];
        };

        // Cache the response
        cacheManager.setPreferences(userDid, pdsData.preferences || []);

        console.log(
          `[PREFERENCES] Retrieved ${pdsData.preferences?.length || 0} preferences from PDS for ${userDid}`
        );
        return res.json({ preferences: pdsData.preferences || [] });
      } else {
        console.warn(
          `[PREFERENCES] PDS request failed for ${userDid}:`,
          pdsResponse.status
        );
        return res.json({ preferences: [] });
      }
    } catch (pdsError) {
      console.error(
        `[PREFERENCES] Error fetching from PDS for ${userDid}:`,
        pdsError
      );
      return res.json({ preferences: [] });
    }
  } catch (error) {
    handleError(res, error, 'getPreferences');
  }
}

/**
 * Update user preferences
 * POST /xrpc/app.bsky.actor.putPreferences
 */
export async function putPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Get authenticated user DID using OAuth token verification
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Parse the preferences from request body
    const body = putActorPreferencesSchema.parse(req.body);

    try {
      // Get user's PDS endpoint from DID document
      const pdsEndpoint = await getUserPdsEndpoint(userDid);
      if (!pdsEndpoint) {
        return res.status(400).json({
          error: 'InvalidRequest',
          message: 'No PDS endpoint found for user',
        });
      }

      // Extract the token from the request - for third-party clients (Bluesky app),
      // they send the PDS token directly. For web UI users, try to get from session.
      const authHeader = req.headers.authorization;
      let pdsToken: string | undefined;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        // Client is already sending a PDS token (app password or OAuth token)
        pdsToken = authHeader.substring(7);
      } else {
        // Fallback: try to get PDS token from session (for web UI users)
        const { storage } = await import('../../../storage');
        const session = await storage.getSession(userDid);
        if (session?.accessToken) {
          pdsToken = session.accessToken;
        }
      }

      if (!pdsToken) {
        return res.status(401).json({
          error: 'AuthMissing',
          message: 'No PDS token found',
        });
      }

      // Forward request to user's PDS with their PDS token (let PDS handle validation)
      console.log(
        `[PREFERENCES] Forwarding putPreferences to ${pdsEndpoint} for ${userDid}`
      );
      console.log(`[PREFERENCES] Request body:`, JSON.stringify(body, null, 2));

      const pdsResponse = await fetch(
        `${pdsEndpoint}/xrpc/app.bsky.actor.putPreferences`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pdsToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (pdsResponse.ok) {
        // Invalidate cache after successful update
        cacheManager.invalidatePreferencesCache(userDid);

        console.log(`[PREFERENCES] Updated preferences via PDS for ${userDid}`);

        // Return success response (no body, like Bluesky)
        return res.status(200).end();
      } else {
        const errorText = await pdsResponse.text();
        console.error(
          `[PREFERENCES] PDS request failed for ${userDid}:`,
          pdsResponse.status,
          errorText
        );
        return res.status(pdsResponse.status).send(errorText);
      }
    } catch (pdsError) {
      console.error(
        `[PREFERENCES] Error updating preferences via PDS for ${userDid}:`,
        pdsError
      );
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Failed to update preferences',
      });
    }
  } catch (error) {
    handleError(res, error, 'putPreferences');
  }
}
