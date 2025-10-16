/**
 * Unspecced Service
 * Handles experimental and unspecced endpoints
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { handleError } from '../utils/error-handler';
import { maybeAvatar } from '../utils/serializers';
import { z } from 'zod';

const unspeccedNoParamsSchema = z.object({
  // No required params
});

/**
 * Get tagged suggestions (unspecced)
 * GET /xrpc/app.bsky.unspecced.getTaggedSuggestions
 */
export async function getTaggedSuggestions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    unspeccedNoParamsSchema.parse(req.query);

    // Return recent users as generic suggestions
    const users = await storage.getSuggestedUsers(undefined, 25);

    res.json({
      suggestions: users.map((u) => ({
        did: u.did,
        handle: u.handle,
        displayName: u.displayName,
        ...maybeAvatar(u.avatarUrl, u.did, req),
      })),
    });
  } catch (error) {
    handleError(res, error, 'getTaggedSuggestions');
  }
}

/**
 * Get trending topics (unspecced)
 * GET /xrpc/app.bsky.unspecced.getTrendingTopics
 */
export async function getTrendingTopics(
  req: Request,
  res: Response
): Promise<void> {
  try {
    unspeccedNoParamsSchema.parse(req.query);

    // Placeholder: compute trending by most reposted authors' handles
    const stats = await storage.getStats();

    res.json({
      topics: stats.totalPosts > 0 ? ['#bluesky', '#atproto'] : [],
    });
  } catch (error) {
    handleError(res, error, 'getTrendingTopics');
  }
}

/**
 * Get trends (unspecced stub)
 * GET /xrpc/app.bsky.unspecced.getTrends
 */
export async function getTrends(req: Request, res: Response): Promise<void> {
  try {
    unspeccedNoParamsSchema.parse(req.query);
    res.json({ trends: [{ topic: '#bluesky', count: 0 }] });
  } catch (error) {
    handleError(res, error, 'getTrends');
  }
}

/**
 * Get unspecced config
 * GET /xrpc/app.bsky.unspecced.getConfig
 */
export async function getUnspeccedConfig(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Get country code from request headers or IP
    // Default to US for self-hosted instances
    const countryCode =
      req.headers['cf-ipcountry'] ||
      req.headers['x-country-code'] ||
      process.env.DEFAULT_COUNTRY_CODE ||
      'US';

    const regionCode =
      req.headers['cf-region-code'] ||
      req.headers['x-region-code'] ||
      process.env.DEFAULT_REGION_CODE ||
      '';

    // For self-hosted instances, disable age restrictions unless explicitly configured
    const isAgeBlockedGeo =
      process.env.AGE_BLOCKED_GEOS?.split(',')?.includes(
        countryCode.toString()
      ) || false;
    const isAgeRestrictedGeo =
      process.env.AGE_RESTRICTED_GEOS?.split(',')?.includes(
        countryCode.toString()
      ) || false;

    res.json({
      liveNowConfig: { enabled: false },
      countryCode: countryCode.toString().substring(0, 2),
      regionCode: regionCode ? regionCode.toString() : undefined,
      isAgeBlockedGeo,
      isAgeRestrictedGeo,
    });
  } catch (error) {
    handleError(res, error, 'getUnspeccedConfig');
  }
}

/**
 * Get age assurance state (stub)
 * GET /xrpc/com.atproto.identity.getAgeAssuranceState
 */
export async function getAgeAssuranceState(
  req: Request,
  res: Response
): Promise<void> {
  try {
    res.json({ state: 'unknown' });
  } catch (error) {
    handleError(res, error, 'getAgeAssuranceState');
  }
}

/**
 * Initialize age assurance (stub)
 * POST /xrpc/com.atproto.identity.initAgeAssurance
 */
export async function initAgeAssurance(
  req: Request,
  res: Response
): Promise<void> {
  try {
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, 'initAgeAssurance');
  }
}
