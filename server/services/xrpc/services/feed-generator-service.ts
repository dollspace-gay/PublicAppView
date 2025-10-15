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
} from '../schemas';

/**
 * Helper to serialize a feed generator view
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
  creator: {
    did: string;
    handle: string;
    displayName?: string;
    avatarUrl?: string;
  },
  req?: Request
) {
  const creatorView: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  } = {
    did: generator.creatorDid,
    handle: creator.handle,
  };
  if (creator.displayName) creatorView.displayName = creator.displayName;
  if (creator.avatarUrl) {
    const avatarUri = transformBlobToCdnUrl(
      creator.avatarUrl,
      creator.did,
      'avatar',
      req
    );
    if (avatarUri && typeof avatarUri === 'string' && avatarUri.trim() !== '') {
      creatorView.avatar = avatarUri;
    }
  }

  const view: {
    uri: string;
    cid: string;
    did: string;
    creator: typeof creatorView;
    displayName: string;
    likeCount: number;
    indexedAt: string;
    description?: string;
    avatar?: string;
  } = {
    uri: generator.uri,
    cid: generator.cid,
    did: generator.did,
    creator: creatorView,
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

    // Creator profile should be available from firehose events
    const creator = await storage.getUser(generatorData.creatorDid);

    if (!creator || !(creator as { handle?: string }).handle) {
      return res.status(500).json({
        error: 'Feed generator creator profile not available',
        message: 'Unable to load creator information',
      });
    }

    const view = serializeFeedGeneratorView(
      generatorData,
      creator as {
        did: string;
        handle: string;
        displayName?: string;
        avatarUrl?: string;
      },
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

    const generators = await storage.getFeedGenerators(params.feeds);

    // Creator profiles should be available from firehose events
    const views = await Promise.all(
      (
        generators as {
          uri: string;
          cid: string;
          did: string;
          creatorDid: string;
          displayName?: string;
          description?: string;
          avatarUrl?: string;
          likeCount: number;
          indexedAt: Date;
        }[]
      ).map(async (generator) => {
        const creator = await storage.getUser(generator.creatorDid);

        // Skip generators from creators without valid handles
        if (!creator || !(creator as { handle?: string }).handle) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`
          );
          return null;
        }

        return serializeFeedGeneratorView(
          generator,
          creator as {
            did: string;
            handle: string;
            displayName?: string;
            avatarUrl?: string;
          },
          req
        );
      })
    );

    // Filter out null entries (generators from creators without valid handles)
    const validViews = views.filter((view) => view !== null);

    res.json({ feeds: validViews });
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

    const { generators, cursor } = await storage.getActorFeeds(
      actorDid,
      params.limit,
      params.cursor
    );

    // Creator profiles should be available from firehose events
    const feeds = await Promise.all(
      (
        generators as {
          uri: string;
          cid: string;
          did: string;
          creatorDid: string;
          displayName?: string;
          description?: string;
          avatarUrl?: string;
          likeCount: number;
          indexedAt: Date;
        }[]
      ).map(async (generator) => {
        const creator = await storage.getUser(generator.creatorDid);

        // Skip generators from creators without valid handles
        if (!creator || !(creator as { handle?: string }).handle) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`
          );
          return null;
        }

        return serializeFeedGeneratorView(
          generator,
          creator as {
            did: string;
            handle: string;
            displayName?: string;
            avatarUrl?: string;
          },
          req
        );
      })
    );

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

    const { generators, cursor } = await storage.getSuggestedFeeds(
      params.limit,
      params.cursor
    );

    // Creator profiles should be available from firehose events
    const feeds = await Promise.all(
      (
        generators as {
          uri: string;
          cid: string;
          did: string;
          creatorDid: string;
          displayName?: string;
          description?: string;
          avatarUrl?: string;
          likeCount: number;
          indexedAt: Date;
        }[]
      ).map(async (generator) => {
        const creator = await storage.getUser(generator.creatorDid);

        // Skip generators from creators without valid handles
        if (!creator || !(creator as { handle?: string }).handle) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`
          );
          return null;
        }

        return serializeFeedGeneratorView(
          generator,
          creator as {
            did: string;
            handle: string;
            displayName?: string;
            avatarUrl?: string;
          },
          req
        );
      })
    );

    // Filter out null entries (generators from creators without valid handles)
    const validFeeds = feeds.filter((feed) => feed !== null);

    res.json({ cursor, feeds: validFeeds });
  } catch (error) {
    handleError(res, error, 'getSuggestedFeeds');
  }
}

/**
 * Describe the feed generator service
 * GET /xrpc/app.bsky.feed.describeFeedGenerator
 */
export async function describeFeedGenerator(
  req: Request,
  res: Response
): Promise<void> {
  try {
    describeFeedGeneratorSchema.parse(req.query);

    const appviewDid = process.env.APPVIEW_DID;
    if (!appviewDid) {
      return res.status(500).json({ error: 'APPVIEW_DID not configured' });
    }

    res.json({
      did: appviewDid,
      feeds: [
        {
          uri: `at://${appviewDid}/app.bsky.feed.generator/reverse-chron`,
        },
      ],
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

    let generators: unknown[];
    let cursor: string | undefined;

    // If query is provided, search for feed generators by name/description
    // Otherwise, return suggested feeds (popular by default)
    if (params.query && params.query.trim()) {
      const searchResults = await storage.searchFeedGeneratorsByName(
        params.query.trim(),
        params.limit,
        params.cursor
      );
      generators = (searchResults as { feedGenerators: unknown[] })
        .feedGenerators;
      cursor = (searchResults as { cursor?: string }).cursor;
    } else {
      const suggestedResults = await storage.getSuggestedFeeds(
        params.limit,
        params.cursor
      );
      generators = (suggestedResults as { generators: unknown[] }).generators;
      cursor = (suggestedResults as { cursor?: string }).cursor;
    }

    // Creator profiles should be available from firehose events
    const feeds = await Promise.all(
      (
        generators as {
          uri: string;
          cid: string;
          did: string;
          creatorDid: string;
          displayName?: string;
          description?: string;
          avatarUrl?: string;
          likeCount: number;
          indexedAt: Date;
        }[]
      ).map(async (generator) => {
        const creator = await storage.getUser(generator.creatorDid);

        // Skip generators from creators without valid handles
        if (!creator || !(creator as { handle?: string }).handle) {
          console.warn(
            `[XRPC] Skipping feed generator ${generator.uri} - creator ${generator.creatorDid} has no handle`
          );
          return null;
        }

        return serializeFeedGeneratorView(
          generator,
          creator as {
            did: string;
            handle: string;
            displayName?: string;
            avatarUrl?: string;
          },
          req
        );
      })
    );

    // Filter out null entries (generators from creators without valid handles)
    const validFeeds = feeds.filter((feed) => feed !== null);

    res.json({ cursor, feeds: validFeeds });
  } catch (error) {
    handleError(res, error, 'getPopularFeedGenerators');
  }
}

/**
 * Get suggested feeds (unspecced version - minimal response)
 * GET /xrpc/app.bsky.unspecced.getSuggestedFeedsUnspecced
 */
export async function getSuggestedFeedsUnspecced(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { generators } = await storage.getSuggestedFeeds(10);
    res.json({
      feeds: (generators as { uri: string }[]).map((g) => g.uri),
    });
  } catch (error) {
    handleError(res, error, 'getSuggestedFeedsUnspecced');
  }
}
