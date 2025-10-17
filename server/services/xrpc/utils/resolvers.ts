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
 * Known PDS providers and their endpoints
 * Used as fallback when DID document resolution fails
 */
const KNOWN_PDS_PROVIDERS: Record<string, string> = {
  'bsky.social': 'https://bsky.social',
  'bsky.app': 'https://bsky.social',
  'staging.bsky.dev': 'https://staging.bsky.dev',
};

/**
 * Attempt to discover PDS endpoint via handle resolution
 * Uses the ATProto handle resolution mechanism (DNS TXT record or HTTPS well-known)
 */
async function discoverPdsViaHandle(handle: string): Promise<string | null> {
  try {
    // Try HTTPS well-known endpoint for handle verification
    // This may also contain PDS information in some implementations
    const wellKnownUrl = `https://${handle}/.well-known/atproto-did`;
    const response = await fetch(wellKnownUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'PublicAppView/1.0' },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (response.ok) {
      const didFromHandle = (await response.text()).trim();
      if (didFromHandle.startsWith('did:')) {
        // We found the DID, but we need to resolve it to get the PDS
        // This creates a recursive resolution attempt, which is intentional
        console.log(
          `[PDS_DISCOVERY] Handle ${handle} resolved to DID via well-known: ${didFromHandle}`
        );
        // Don't recurse here - just return null and let caller handle it
        return null;
      }
    }
  } catch (error) {
    // Well-known resolution failed, which is expected for most handles
    console.log(
      `[PDS_DISCOVERY] Well-known resolution failed for handle ${handle} (this is normal)`
    );
  }

  return null;
}

/**
 * Extract domain from handle and validate it
 * Returns null if handle format is invalid
 */
function extractDomainFromHandle(handle: string): string | null {
  if (!handle || typeof handle !== 'string') {
    return null;
  }

  // Handle must be a valid domain format
  // Examples: alice.bsky.social, bob.example.com, charlie.co.uk
  const parts = handle.toLowerCase().split('.');

  if (parts.length < 2) {
    return null; // Invalid handle format
  }

  // Check for known multi-part TLDs (e.g., .co.uk, .com.au)
  const knownMultiPartTlds = [
    'co.uk',
    'com.au',
    'co.nz',
    'co.za',
    'com.br',
    'co.jp',
    'ac.uk',
    'gov.uk',
  ];

  // Try to extract domain intelligently
  if (parts.length >= 3) {
    const lastTwoParts = parts.slice(-2).join('.');
    if (knownMultiPartTlds.includes(lastTwoParts)) {
      // Handle multi-part TLD: take last 3 parts (subdomain.domain.co.uk -> domain.co.uk)
      if (parts.length >= 3) {
        return parts.slice(-3).join('.');
      }
    }
  }

  // Default: take last 2 parts (subdomain.domain.com -> domain.com)
  return parts.slice(-2).join('.');
}

/**
 * Get PDS endpoint for a user DID
 * Enhanced with improved fallback logic and better error handling
 */
export async function getUserPdsEndpoint(
  userDid: string
): Promise<string | null> {
  try {
    // Step 0: Check cache first
    const cachedEndpoint = cacheManager.getPdsEndpoint(userDid);
    if (cachedEndpoint) {
      console.log(
        `[PDS_DISCOVERY] ✓ Cache hit for ${userDid}: ${cachedEndpoint}`
      );
      return cachedEndpoint;
    }

    // Step 1: Resolve DID document to find PDS endpoint (primary method)
    const didDoc = await resolveDidDocument(userDid);

    if (didDoc) {
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
            `[PDS_DISCOVERY] SECURITY: Blocked unsafe PDS endpoint for ${userDid}: ${endpoint}`
          );
          // Don't return null immediately - try fallback methods
        } else {
          console.log(
            `[PDS_DISCOVERY] ✓ Resolved PDS from DID document: ${endpoint}`
          );
          // Cache the successfully resolved endpoint
          cacheManager.cachePdsEndpoint(userDid, endpoint);
          return endpoint;
        }
      }
    }

    // Step 2: Fallback to handle-based resolution
    console.log(
      `[PDS_DISCOVERY] DID document resolution failed or missing PDS service, trying handle-based fallback for ${userDid}`
    );

    const user = await storage.getUser(userDid);
    if (!user?.handle) {
      console.warn(
        `[PDS_DISCOVERY] No handle found for ${userDid}, cannot use fallback`
      );
      return null;
    }

    const handle = user.handle.toLowerCase();
    console.log(`[PDS_DISCOVERY] Found handle: ${handle}`);

    // Step 2a: Check known PDS providers (fast path)
    for (const [domain, pdsEndpoint] of Object.entries(KNOWN_PDS_PROVIDERS)) {
      if (handle.endsWith(`.${domain}`) || handle === domain) {
        console.log(
          `[PDS_DISCOVERY] ✓ Matched known provider: ${domain} -> ${pdsEndpoint}`
        );
        // Cache the successfully resolved endpoint
        cacheManager.cachePdsEndpoint(userDid, pdsEndpoint);
        return pdsEndpoint;
      }
    }

    // Step 2b: Try handle-based discovery (ATProto well-known)
    const discoveredPds = await discoverPdsViaHandle(handle);
    if (discoveredPds) {
      // Validate before returning
      if (isUrlSafeToFetch(discoveredPds)) {
        console.log(
          `[PDS_DISCOVERY] ✓ Discovered PDS via handle: ${discoveredPds}`
        );
        // Cache the successfully resolved endpoint
        cacheManager.cachePdsEndpoint(userDid, discoveredPds);
        return discoveredPds;
      } else {
        console.warn(
          `[PDS_DISCOVERY] SECURITY: Blocked unsafe discovered PDS: ${discoveredPds}`
        );
      }
    }

    // Step 2c: Extract domain from handle and construct PDS URL
    const domain = extractDomainFromHandle(handle);
    if (domain) {
      const constructedPds = `https://${domain}`;

      // Validate the constructed URL
      if (isUrlSafeToFetch(constructedPds)) {
        console.log(
          `[PDS_DISCOVERY] ⚠ Using constructed PDS URL from handle domain (may be incorrect): ${constructedPds}`
        );
        console.log(
          `[PDS_DISCOVERY] ⚠ This is a heuristic fallback - the PDS may not be at this domain`
        );
        // Cache the constructed endpoint with shorter TTL (since it's less reliable)
        // Note: The cache uses a fixed TTL, but this could be enhanced to use different TTLs
        cacheManager.cachePdsEndpoint(userDid, constructedPds);
        return constructedPds;
      } else {
        console.warn(
          `[PDS_DISCOVERY] SECURITY: Blocked unsafe constructed PDS: ${constructedPds}`
        );
      }
    }

    // Step 3: All methods failed
    console.error(
      `[PDS_DISCOVERY] ✗ Failed to resolve PDS endpoint for ${userDid} (handle: ${handle})`
    );
    console.error(
      `[PDS_DISCOVERY] Recommendation: Ensure DID document is properly configured with PDS service endpoint`
    );
    return null;
  } catch (error) {
    console.error(
      `[PDS_DISCOVERY] Error resolving PDS endpoint for ${userDid}:`,
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
