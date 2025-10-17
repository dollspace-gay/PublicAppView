/**
 * Feed Generator Service
 * Handles feed generator discovery, queries, and descriptions
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import { transformBlobToCdnUrl } from '../utils/serializers';
import {
  getFeedGeneratorSchema,
  getFeedGeneratorsSchema,
  getActorFeedsSchema,
  getSuggestedFeedsSchema,
  describeFeedGeneratorSchema,
  getPopularFeedGeneratorsSchema,
  getSuggestedFeedsUnspeccedSchema,
} from '../schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Helper to serialize a feed generator view
 * Now accepts full profileView from _getProfiles for complete creator data
 */
function serializeFeedGeneratorView(
  generator: {
    uri: string;
    cid: string;
    did: string;
    creatorDid: string;
    displayName?: string;
    description?: string;
    avatarUrl?: string;
    likeCount: number;
    indexedAt: Date;
  },
  creatorProfile: any, // Full profileView from _getProfiles
  req?: Request
) {
  const view: any = {
    uri: generator.uri,
    cid: generator.cid,
    did: generator.did,
    creator: creatorProfile, // Full profileView object
    displayName: generator.displayName || 'Unnamed Feed',
    likeCount: generator.likeCount,
    indexedAt: generator.indexedAt.toISOString(),
  };

  if (generator.description) view.description = generator.description;
  if (generator.avatarUrl) {
    const avatarUri = transformBlobToCdnUrl(
      generator.avatarUrl,
      generator.creatorDid,
      'avatar',
      req
    );
    if (avatarUri && typeof avatarUri === 'string' && avatarUri.trim() !== '') {
      view.avatar = avatarUri;
    }
  }

  return view;
}

/**
 * Get a single feed generator
 * GET /xrpc/app.bsky.feed.getFeedGenerator
 */
export async function getFeedGenerator(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getFeedGeneratorSchema.parse(req.query);

    const generator = await storage.getFeedGenerator(params.feed);
    if (!generator) {
      return res.status(404).json({ error: 'Feed generator not found' });
    }

    const generatorData = generator as {
      uri: string;
      cid: string;
      did: string;
      creatorDid: string;
      displayName?: string;
      description?: string;
      avatarUrl?: string;
      likeCount: number;
      indexedAt: Date;
    };

    // Use _getProfiles for complete creator profileView
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      [generatorData.creatorDid],
      req
    );

    if (creatorProfiles.length === 0) {
      return res.status(500).json({
        error: 'Feed generator creator profile not available',
        message: 'Unable to load creator information',
      });
    }

    const view = serializeFeedGeneratorView(
      generatorData,
      creatorProfiles[0],
      req
    );

    res.json({
      view,
      isOnline: true,
      isValid: true,
    });
  } catch (error) {
    handleError(res, error, 'getFeedGenerator');
  }
}

/**
 * Get multiple feed generators
 * GET /xrpc/app.bsky.feed.getFeedGenerators
 */
export async function getFeedGenerators(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getFeedGeneratorsSchema.parse(req.query);

    const generators = (await storage.getFeedGenerators(params.feeds)) as {
      uri: string;
      cid: string;
      did: string;
      creatorDid: string;
      displayName?: string;
      description?: string;
      avatarUrl?: string;
      likeCount: number;
      indexedAt: Date;
    }[];

    if (generators.length === 0) {
      return res.json({ feeds: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(generators.map((g) => g.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Build views with complete creator profiles
    const views = generators
      .map((generator) => {
        const creatorProfile = profileMap.get(generator.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} profile not found`
          );
          return null;
        }

        return serializeFeedGeneratorView(generator, creatorProfile, req);
      })
      .filter(Boolean);

    res.json({ feeds: views });
  } catch (error) {
    handleError(res, error, 'getFeedGenerators');
  }
}

/**
 * Get feed generators created by an actor
 * GET /xrpc/app.bsky.feed.getActorFeeds
 */
export async function getActorFeeds(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getActorFeedsSchema.parse(req.query);

    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    const { generators, cursor } = (await storage.getActorFeeds(
      actorDid,
      params.limit,
      params.cursor
    )) as {
      generators: {
        uri: string;
        cid: string;
        did: string;
        creatorDid: string;
        displayName?: string;
        description?: string;
        avatarUrl?: string;
        likeCount: number;
        indexedAt: Date;
      }[];
      cursor?: string;
    };

    if (generators.length === 0) {
      return res.json({ cursor, feeds: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(generators.map((g) => g.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Build views with complete creator profiles
    const feeds = generators
      .map((generator) => {
        const creatorProfile = profileMap.get(generator.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} profile not found`
          );
          return null;
        }

        return serializeFeedGeneratorView(generator, creatorProfile, req);
      })
      .filter(Boolean);

    res.json({ cursor, feeds });
  } catch (error) {
    handleError(res, error, 'getActorFeeds');
  }
}

/**
 * Get suggested feed generators
 * GET /xrpc/app.bsky.feed.getSuggestedFeeds
 */
export async function getSuggestedFeeds(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getSuggestedFeedsSchema.parse(req.query);

    const { generators, cursor } = (await storage.getSuggestedFeeds(
      params.limit,
      params.cursor
    )) as {
      generators: {
        uri: string;
        cid: string;
        did: string;
        creatorDid: string;
        displayName?: string;
        description?: string;
        avatarUrl?: string;
        likeCount: number;
        indexedAt: Date;
      }[];
      cursor?: string;
    };

    if (generators.length === 0) {
      return res.json({ cursor, feeds: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(generators.map((g) => g.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Build views with complete creator profiles
    const feeds = generators
      .map((generator) => {
        const creatorProfile = profileMap.get(generator.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} profile not found`
          );
          return null;
        }

        return serializeFeedGeneratorView(generator, creatorProfile, req);
      })
      .filter(Boolean);

    res.json({ cursor, feeds });
  } catch (error) {
    handleError(res, error, 'getSuggestedFeeds');
  }
}

/**
 * Describe the feed generator service
 * GET /xrpc/app.bsky.feed.describeFeedGenerator
 *
 * NOTE: Per ATProto spec, this endpoint is "implemented by Feed Generator services (not App View)."
 * This is an AppView, not a Feed Generator service. Feed Generator services are external
 * services that generate custom feeds, which this AppView consumes via feedGeneratorClient.
 *
 * Returns 501 Not Implemented to indicate this endpoint belongs on Feed Generator services.
 */
export async function describeFeedGenerator(
  req: Request,
  res: Response
): Promise<void> {
  try {
    describeFeedGeneratorSchema.parse(req.query);

    res.status(501).json({
      error: 'NotImplemented',
      message:
        'This endpoint is for Feed Generator services, not AppView. ' +
        'Feed Generator services implement this endpoint to describe their feed offerings. ' +
        'This is an AppView that consumes feeds from external Feed Generator services.',
    });
  } catch (error) {
    handleError(res, error, 'describeFeedGenerator');
  }
}

/**
 * Get popular feed generators (with optional search)
 * GET /xrpc/app.bsky.unspecced.getPopularFeedGenerators
 */
export async function getPopularFeedGenerators(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getPopularFeedGeneratorsSchema.parse(req.query);

    let generators: {
      uri: string;
      cid: string;
      did: string;
      creatorDid: string;
      displayName?: string;
      description?: string;
      avatarUrl?: string;
      likeCount: number;
      indexedAt: Date;
    }[];
    let cursor: string | undefined;

    // If query is provided, search for feed generators by name/description
    // Otherwise, return suggested feeds (popular by default)
    if (params.query && params.query.trim()) {
      const searchResults = await storage.searchFeedGeneratorsByName(
        params.query.trim(),
        params.limit,
        params.cursor
      );
      generators = (searchResults as { feedGenerators: typeof generators })
        .feedGenerators;
      cursor = (searchResults as { cursor?: string }).cursor;
    } else {
      const suggestedResults = await storage.getSuggestedFeeds(
        params.limit,
        params.cursor
      );
      generators = (suggestedResults as { generators: typeof generators })
        .generators;
      cursor = (suggestedResults as { cursor?: string }).cursor;
    }

    if (generators.length === 0) {
      return res.json({ cursor, feeds: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(generators.map((g) => g.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Build views with complete creator profiles
    const feeds = generators
      .map((generator) => {
        const creatorProfile = profileMap.get(generator.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} profile not found`
          );
          return null;
        }

        return serializeFeedGeneratorView(generator, creatorProfile, req);
      })
      .filter(Boolean);

    res.json({ cursor, feeds });
  } catch (error) {
    handleError(res, error, 'getPopularFeedGenerators');
  }
}

/**
 * Get suggested feeds (unspecced)
 * GET /xrpc/app.bsky.unspecced.getSuggestedFeeds
 *
 * IMPORTANT: This endpoint is experimental and marked as "unspecced" in the ATProto specification.
 * Returns a list of suggested feed generators with complete generatorView objects.
 */
export async function getSuggestedFeedsUnspecced(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getSuggestedFeedsUnspeccedSchema.parse(req.query);

    const { generators } = (await storage.getSuggestedFeeds(params.limit)) as {
      generators: {
        uri: string;
        cid: string;
        did: string;
        creatorDid: string;
        displayName?: string;
        description?: string;
        avatarUrl?: string;
        likeCount: number;
        indexedAt: Date;
      }[];
    };

    if (generators.length === 0) {
      return res.json({ feeds: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(generators.map((g) => g.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Build views with complete creator profiles
    const feeds = generators
      .map((generator) => {
        const creatorProfile = profileMap.get(generator.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} profile not found`
          );
          return null;
        }

        return serializeFeedGeneratorView(generator, creatorProfile, req);
      })
      .filter(Boolean);

    res.json({ feeds });
  } catch (error) {
    handleError(res, error, 'getSuggestedFeedsUnspecced');
  }
}
