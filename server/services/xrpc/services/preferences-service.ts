/**
 * Preferences Service
 * Handles user preferences (get and update)
 */

import type { Request, Response } from 'express';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { putActorPreferencesSchema } from '../schemas';
import { appViewJWTService } from '../../appview-jwt';

/**
 * Get user preferences
 * GET /xrpc/app.bsky.actor.getPreferences
 *
 * Uses service-auth tokens to fetch preferences from user's PDS
 */
export async function getPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Get authenticated user DID using OAuth token verification
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    console.log(`[PREFERENCES] Fetching preferences for ${userDid}`);

    // Get user's PDS endpoint
    const { didResolver } = await import('../../did-resolver');
    const didDoc = await didResolver.resolveDID(userDid);

    if (!didDoc) {
      return res.status(400).json({
        error: 'InvalidRequest',
        message: 'Could not resolve user DID document',
      });
    }

    const services = (didDoc as any).service || [];
    const pdsService = services.find(
      (s: any) =>
        s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
    );

    if (!pdsService?.serviceEndpoint) {
      return res.status(400).json({
        error: 'InvalidRequest',
        message: 'No PDS endpoint found for user',
      });
    }

    const pdsEndpoint = pdsService.serviceEndpoint;

    // Get the PDS DID from describeServer
    const pdsDid = await getPdsDid(pdsEndpoint);

    if (!pdsDid) {
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Could not determine PDS DID',
      });
    }

    console.log(
      `[PREFERENCES] PDS endpoint: ${pdsEndpoint}`
    );
    console.log(
      `[PREFERENCES] Creating service-auth token for ${userDid} -> ${pdsDid}`
    );

    // Create service-auth token with correct audience (PDS DID)
    const serviceAuthToken = appViewJWTService.signServiceAuthToken(
      userDid,
      pdsDid,
      'app.bsky.actor.getPreferences'
    );

    // Decode and log the token payload for debugging
    try {
      const tokenParts = serviceAuthToken.split('.');
      if (tokenParts.length === 3) {
        const header = JSON.parse(Buffer.from(tokenParts[0], 'base64url').toString());
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
        console.log(`[PREFERENCES] Service-auth token header:`, header);
        console.log(`[PREFERENCES] Service-auth token payload:`, payload);
      }
    } catch (e) {
      console.log(`[PREFERENCES] Could not decode service-auth token for debugging`);
    }

    // Fetch from PDS
    console.log(`[PREFERENCES] Sending GET request to PDS...`);
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
      console.log(
        `[PREFERENCES] Successfully retrieved ${pdsData.preferences?.length || 0} preferences from PDS`
      );
      return res.json({ preferences: pdsData.preferences || [] });
    } else {
      const errorText = await pdsResponse.text();
      console.error(
        `[PREFERENCES] PDS rejected service-auth (${pdsResponse.status}):`,
        errorText
      );
      return res.status(pdsResponse.status).json({
        error: 'PDS Error',
        message: errorText || 'Failed to fetch preferences from PDS',
      });
    }
  } catch (error) {
    console.error(`[PREFERENCES] Error fetching preferences:`, error);
    handleError(res, error, 'getPreferences');
  }
}

/**
 * Update user preferences
 * POST /xrpc/app.bsky.actor.putPreferences
 *
 * Uses service-auth tokens to update preferences on user's PDS
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

    // Get user's PDS endpoint
    const { didResolver } = await import('../../did-resolver');
    const didDoc = await didResolver.resolveDID(userDid);

    if (!didDoc) {
      return res.status(400).json({
        error: 'InvalidRequest',
        message: 'Could not resolve user DID document',
      });
    }

    const services = (didDoc as any).service || [];
    const pdsService = services.find(
      (s: any) =>
        s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
    );

    if (!pdsService?.serviceEndpoint) {
      return res.status(400).json({
        error: 'InvalidRequest',
        message: 'No PDS endpoint found for user',
      });
    }

    const pdsEndpoint = pdsService.serviceEndpoint;
    const pdsDid = await getPdsDid(pdsEndpoint);

    if (!pdsDid) {
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Could not determine PDS DID',
      });
    }

    console.log(
      `[PREFERENCES] PDS endpoint: ${pdsEndpoint}`
    );
    console.log(
      `[PREFERENCES] Creating service-auth token for ${userDid} -> ${pdsDid}`
    );

    const serviceAuthToken = appViewJWTService.signServiceAuthToken(
      userDid,
      pdsDid,
      'app.bsky.actor.putPreferences'
    );

    // Decode and log the token payload for debugging
    try {
      const tokenParts = serviceAuthToken.split('.');
      if (tokenParts.length === 3) {
        const header = JSON.parse(Buffer.from(tokenParts[0], 'base64url').toString());
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
        console.log(`[PREFERENCES] Service-auth token header:`, header);
        console.log(`[PREFERENCES] Service-auth token payload:`, payload);
      }
    } catch (e) {
      console.log(`[PREFERENCES] Could not decode service-auth token for debugging`);
    }

    console.log(`[PREFERENCES] Sending PUT request to PDS...`);
    console.log(`[PREFERENCES] Request body:`, JSON.stringify(body, null, 2));

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
      console.log(
        `[PREFERENCES] Successfully updated preferences on PDS for ${userDid}`
      );
      return res.status(200).end();
    } else {
      const errorText = await pdsResponse.text();
      console.error(
        `[PREFERENCES] PDS rejected service-auth (${pdsResponse.status}):`,
        errorText
      );
      return res.status(pdsResponse.status).json({
        error: 'PDS Error',
        message: errorText || 'Failed to update preferences on PDS',
      });
    }
  } catch (error) {
    console.error(`[PREFERENCES] Error updating preferences:`, error);
    handleError(res, error, 'putPreferences');
  }
}

/**
 * Get PDS DID by calling describeServer endpoint
 */
async function getPdsDid(pdsEndpoint: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${pdsEndpoint}/xrpc/com.atproto.server.describeServer`
    );

    if (!response.ok) {
      console.error(
        `[PREFERENCES] Failed to fetch PDS DID from ${pdsEndpoint}: ${response.status}`
      );
      return null;
    }

    const data = (await response.json()) as { did?: string };
    return data.did || null;
  } catch (error) {
    console.error(
      `[PREFERENCES] Error fetching PDS DID from ${pdsEndpoint}:`,
      error
    );
    return null;
  }
}
