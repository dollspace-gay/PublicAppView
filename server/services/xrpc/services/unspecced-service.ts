/**
 * Unspecced Service
 * Handles experimental and unspecced endpoints
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { handleError } from '../utils/error-handler';
import { getTrendsSchema, unspeccedNoParamsSchema } from '../schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get tagged suggestions (unspecced)
 * GET /xrpc/app.bsky.unspecced.getTaggedSuggestions
 *
 * IMPORTANT: This endpoint is experimental and marked as "unspecced" in the ATProto specification.
 * Returns categorized suggestions for feeds and users with tags.
 *
 * Response format per spec:
 * - tag: Category identifier (e.g., "popular", "tech", "news")
 * - subjectType: "actor" or "feed"
 * - subject: AT-URI of the suggested resource
 */
export async function getTaggedSuggestions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    unspeccedNoParamsSchema.parse(req.query);

    const suggestions: Array<{
      tag: string;
      subjectType: 'actor' | 'feed';
      subject: string;
    }> = [];

    // Get suggested users and tag them
    const { users } = await storage.getSuggestedUsers(undefined, 10);
    for (const user of users as { did: string }[]) {
      suggestions.push({
        tag: 'suggested-users',
        subjectType: 'actor',
        subject: user.did, // Using DID as subject (can be used to fetch full profile)
      });
    }

    // Get suggested feeds and tag them
    const { generators } = (await storage.getSuggestedFeeds(10)) as {
      generators: { uri: string }[];
    };
    for (const generator of generators) {
      suggestions.push({
        tag: 'suggested-feeds',
        subjectType: 'feed',
        subject: generator.uri, // AT-URI of the feed generator
      });
    }

    // TODO: Implement more sophisticated tagging logic
    // - Categorize by topic (tech, news, sports, etc.)
    // - Use trending/popular tags
    // - Personalize based on user interests
    // For now, we use generic "suggested-users" and "suggested-feeds" tags

    res.json({ suggestions });
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
 * Get trends (unspecced)
 * GET /xrpc/app.bsky.unspecced.getTrends
 *
 * IMPORTANT: This endpoint is experimental and marked as "unspecced" in the ATProto specification.
 * Returns trending topics with engagement metrics and associated user profiles.
 *
 * Response format per spec (trendView):
 * - topic: Trend topic/hashtag
 * - displayName: Display name for the trend
 * - link: Link to the trend
 * - startedAt: When the trend started
 * - postCount: Number of posts in this trend
 * - actors: Array of profileViewBasic objects
 * - status: Optional "hot" indicator
 * - category: Optional category
 */
export async function getTrends(req: Request, res: Response): Promise<void> {
  try {
    const params = getTrendsSchema.parse(req.query);

    // TODO: Implement real trending logic based on:
    // - Recent post counts by hashtag/topic
    // - Velocity of engagement (likes, reposts, replies)
    // - Time-based trending windows
    // - Geographic/network-wide trends

    // For now, return placeholder trends with proper structure
    const placeholderTrends = [
      {
        topic: '#bluesky',
        displayName: 'Bluesky',
        category: 'social-media',
      },
      {
        topic: '#atproto',
        displayName: 'AT Protocol',
        category: 'technology',
      },
    ];

    const trends = await Promise.all(
      placeholderTrends.slice(0, params.limit).map(async (trend) => {
        // Get some users to associate with the trend (placeholder)
        const { users } = await storage.getSuggestedUsers(undefined, 3);
        const userDids = (users as { did: string }[]).map((u) => u.did);

        // Hydrate user profiles
        const actors =
          userDids.length > 0
            ? await (xrpcApi as any)._getProfiles(userDids, req)
            : [];

        return {
          topic: trend.topic,
          displayName: trend.displayName,
          link: `https://bsky.app/search?q=${encodeURIComponent(trend.topic)}`,
          startedAt: new Date(Date.now() - 3600000).toISOString(), // Started 1 hour ago
          postCount: Math.floor(Math.random() * 1000) + 100, // Placeholder count
          actors: actors.slice(0, 3), // Include up to 3 actors
          status: 'hot',
          category: trend.category,
        };
      })
    );

    res.json({ trends });
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
 * Get age assurance state
 * GET /xrpc/app.bsky.unspecced.getAgeAssuranceState
 *
 * IMPORTANT: This AppView will NEVER provide age assurance/verification services.
 *
 * Age verification is a sensitive legal and privacy matter that requires:
 * - Compliance with varying international age verification laws (COPPA, GDPR, etc.)
 * - Secure handling of personal identification documents
 * - Legal liability and regulatory oversight
 * - Infrastructure for identity verification
 *
 * This is an explicit architectural decision that age assurance is NOT and will NEVER
 * be provided by this AppView under any circumstances. Users must handle age verification
 * through their PDS or other appropriate identity services.
 */
export async function getAgeAssuranceState(
  req: Request,
  res: Response
): Promise<void> {
  try {
    res.status(501).json({
      error: 'NotImplemented',
      message:
        'This AppView does not and will never provide age assurance services. ' +
        'Age verification is a sensitive legal matter requiring compliance with international laws, ' +
        'secure handling of personal identification, and regulatory oversight. ' +
        'Users must handle age verification through their PDS or appropriate identity services.',
    });
  } catch (error) {
    handleError(res, error, 'getAgeAssuranceState');
  }
}

/**
 * Initialize age assurance
 * POST /xrpc/app.bsky.unspecced.initAgeAssurance
 *
 * IMPORTANT: This AppView will NEVER provide age assurance/verification services.
 *
 * Age verification is a sensitive legal and privacy matter that requires:
 * - Compliance with varying international age verification laws (COPPA, GDPR, etc.)
 * - Secure handling of personal identification documents
 * - Legal liability and regulatory oversight
 * - Infrastructure for identity verification
 *
 * This is an explicit architectural decision that age assurance is NOT and will NEVER
 * be provided by this AppView under any circumstances. Users must handle age verification
 * through their PDS or other appropriate identity services.
 */
export async function initAgeAssurance(
  req: Request,
  res: Response
): Promise<void> {
  try {
    res.status(501).json({
      error: 'NotImplemented',
      message:
        'This AppView does not and will never provide age assurance services. ' +
        'Age verification is a sensitive legal matter requiring compliance with international laws, ' +
        'secure handling of personal identification, and regulatory oversight. ' +
        'Users must handle age verification through their PDS or appropriate identity services.',
    });
  } catch (error) {
    handleError(res, error, 'initAgeAssurance');
  }
}
