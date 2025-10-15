/**
 * Resolver Utilities
 * Handles DID resolution, actor resolution, and PDS endpoint discovery
 */

import type { Response } from 'express';
import { storage } from '../../../storage';
import { isUrlSafeToFetch } from '../../../utils/security';
import { cacheManager } from './cache';

/**
 * Resolve DID document from PLC directory
 */
export async function resolveDidDocument(did: string): Promise<unknown | null> {
  try {
    // Simple DID resolution - in production you'd use a proper DID resolver
    const response = await fetch(`https://plc.directory/${did}`);
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    console.error(
      `[PREFERENCES] Error resolving DID document for ${did}:`,
      error
    );
    return null;
  }
}

/**
 * Get PDS endpoint for a user DID
 */
export async function getUserPdsEndpoint(
  userDid: string
): Promise<string | null> {
  try {
    // Resolve DID document to find PDS endpoint
    const didDoc = await resolveDidDocument(userDid);
    if (!didDoc) return null;

    // Look for PDS endpoint in service endpoints
    const services = (didDoc as { service?: unknown[] }).service || [];
    const pdsService = services.find((service: unknown) => {
      const svc = service as { type?: string; id?: string };
      return (
        svc.type === 'AtprotoPersonalDataServer' || svc.id === '#atproto_pds'
      );
    });

    if (
      pdsService &&
      (pdsService as { serviceEndpoint?: string }).serviceEndpoint
    ) {
      const endpoint = (pdsService as { serviceEndpoint: string })
        .serviceEndpoint;

      // SECURITY: Validate PDS endpoint to prevent SSRF attacks
      // Malicious DID documents could point to internal services
      if (!isUrlSafeToFetch(endpoint)) {
        console.error(
          `[XRPC] SECURITY: Blocked unsafe PDS endpoint for ${userDid}: ${endpoint}`
        );
        return null;
      }

      return endpoint;
    }

    // Fallback: try to construct PDS URL from handle if available
    const user = await storage.getUser(userDid);
    if (user?.handle) {
      // For now, assume bsky.social PDS for handles ending in .bsky.social
      if (user.handle.endsWith('.bsky.social')) {
        return 'https://bsky.social';
      }
      // For other handles, try to construct PDS URL
      // This is a simplified approach - in production you'd need more sophisticated PDS discovery
      return `https://${user.handle.split('.').slice(-2).join('.')}`;
    }

    return null;
  } catch (error) {
    console.error(
      `[PREFERENCES] Error resolving PDS endpoint for ${userDid}:`,
      error
    );
    return null;
  }
}

/**
 * Resolve actor identifier (handle or DID) to DID
 * Checks cache first, then database
 * Returns null and sends 404 response if not found
 */
export async function resolveActor(
  res: Response,
  actor: string
): Promise<string | null> {
  if (actor.startsWith('did:')) {
    // A small optimization would be to check if the user exists in the DB.
    // But for now, subsequent queries will fail, which is acceptable.
    return actor;
  }

  const handle = actor.toLowerCase();

  // Check cache first
  const cachedDid = cacheManager.getResolvedHandle(handle);
  if (cachedDid) {
    return cachedDid;
  }

  console.log(`[RESOLVE_ACTOR] Looking up handle: ${actor}`);
  const user = await storage.getUserByHandle(handle);
  if (!user) {
    console.log(`[RESOLVE_ACTOR] User not found in database: ${actor}`);
    res.status(404).json({ error: 'NotFound', message: 'Actor not found' });
    return null;
  }

  // Cache the result
  cacheManager.cacheHandleResolution(handle, user.did);

  console.log(`[RESOLVE_ACTOR] Found user: ${actor} -> ${user.did}`);
  return user.did;
}
