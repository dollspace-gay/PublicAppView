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
import { appViewJWTService } from '../../appview-jwt';

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

    console.log(`[PREFERENCES] Cache miss for ${userDid}, fetching from PDS`);

    try {
      // Get user's PDS endpoint and DID from DID document
      const { didResolver } = await import('../../did-resolver');
      const didDoc = await didResolver.resolveDID(userDid);

      if (!didDoc) {
        console.warn(`[PREFERENCES] Could not resolve DID document for ${userDid}`);
        return res.json({ preferences: [] });
      }

      // Find PDS service
      const services = (didDoc as any).service || [];
      const pdsService = services.find(
        (s: any) =>
          s.type === 'AtprotoPersonalDataServer' ||
          s.id === '#atproto_pds'
      );

      if (!pdsService?.serviceEndpoint) {
        console.warn(`[PREFERENCES] No PDS endpoint found for ${userDid}`);
        return res.json({ preferences: [] });
      }

      const pdsEndpoint = pdsService.serviceEndpoint;

      // Extract PDS DID from service ID (format: did:plc:xxx#atproto_pds)
      const pdsDid = pdsService.id.startsWith('did:')
        ? pdsService.id.split('#')[0]
        : userDid; // Fallback to user's DID if service doesn't have its own DID

      console.log(`[PREFERENCES] Creating service-auth token for ${userDid} -> ${pdsDid}`);

      // Create service-auth token (AppView acting on behalf of user)
      const serviceAuthToken = appViewJWTService.signServiceAuthToken(
        userDid,
        pdsDid,
        'app.bsky.actor.getPreferences'
      );

      // Forward request to user's PDS with service-auth token
      const pdsResponse = await fetch(
        `${pdsEndpoint}/xrpc/app.bsky.actor.getPreferences`,
        {
          headers: {
            Authorization: `Bearer ${serviceAuthToken}`,
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
        const errorText = await pdsResponse.text();
        console.error(
          `[PREFERENCES] GET failed for ${userDid}: ${pdsResponse.status}`,
          errorText
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

    console.log(`[PREFERENCES] Updating preferences for ${userDid}`);

    try {
      // Get user's PDS endpoint and DID from DID document
      const { didResolver } = await import('../../did-resolver');
      const didDoc = await didResolver.resolveDID(userDid);

      if (!didDoc) {
        return res.status(400).json({
          error: 'InvalidRequest',
          message: 'Could not resolve user DID document',
        });
      }

      // Find PDS service
      const services = (didDoc as any).service || [];
      const pdsService = services.find(
        (s: any) =>
          s.type === 'AtprotoPersonalDataServer' ||
          s.id === '#atproto_pds'
      );

      if (!pdsService?.serviceEndpoint) {
        return res.status(400).json({
          error: 'InvalidRequest',
          message: 'No PDS endpoint found for user',
        });
      }

      const pdsEndpoint = pdsService.serviceEndpoint;

      // Extract PDS DID from service ID
      const pdsDid = pdsService.id.startsWith('did:')
        ? pdsService.id.split('#')[0]
        : userDid;

      console.log(`[PREFERENCES] Creating service-auth token for ${userDid} -> ${pdsDid}`);

      // Create service-auth token (AppView acting on behalf of user)
      const serviceAuthToken = appViewJWTService.signServiceAuthToken(
        userDid,
        pdsDid,
        'app.bsky.actor.putPreferences'
      );

      // Forward request to user's PDS with service-auth token
      const pdsResponse = await fetch(
        `${pdsEndpoint}/xrpc/app.bsky.actor.putPreferences`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceAuthToken}`,
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
          `[PREFERENCES] PUT failed for ${userDid}: ${pdsResponse.status}`,
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
