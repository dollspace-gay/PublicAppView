/**
 * Starter Pack Service
 * Handles starter pack queries and discovery
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import { transformBlobToCdnUrl } from '../utils/serializers';
import {
  getStarterPackSchema,
  getStarterPacksSchema,
  getActorStarterPacksSchema,
  getStarterPacksWithMembershipSchema,
} from '../schemas';

/**
 * Get a single starter pack by URI
 * GET /xrpc/app.bsky.graph.getStarterPack
 */
export async function getStarterPack(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getStarterPackSchema.parse(req.query);

    const pack = await storage.getStarterPack(params.starterPack);
    if (!pack) {
      return res.status(404).json({ error: 'Starter pack not found' });
    }

    const packData = pack as {
      creatorDid: string;
      listUri?: string;
      name: string;
      description?: string;
      feeds?: unknown[];
      uri: string;
      cid: string;
      createdAt: Date;
      indexedAt: Date;
    };

    // Creator profile should be available from firehose events
    const creator = await storage.getUser(packData.creatorDid);

    if (!creator || !(creator as { handle?: string }).handle) {
      return res.status(500).json({
        error: 'Starter pack creator profile not available',
        message: 'Unable to load creator information',
      });
    }

    const creatorData = creator as {
      handle: string;
      displayName?: string;
      avatarUrl?: string;
      did: string;
    };

    let list = null;
    if (packData.listUri) {
      list = await storage.getList(packData.listUri);
    }

    const creatorView: {
      did: string;
      handle: string;
      displayName?: string;
      avatar?: string;
    } = {
      did: packData.creatorDid,
      handle: creatorData.handle,
    };
    if (creatorData.displayName)
      creatorView.displayName = creatorData.displayName;
    if (creatorData.avatarUrl) {
      const avatarUrl = transformBlobToCdnUrl(
        creatorData.avatarUrl,
        creatorData.did,
        'avatar',
        req
      );
      if (
        avatarUrl &&
        typeof avatarUrl === 'string' &&
        avatarUrl.trim() !== ''
      ) {
        creatorView.avatar = avatarUrl;
      }
    }

    const record: {
      name: string;
      list?: string;
      feeds?: unknown[];
      createdAt: string;
      description?: string;
    } = {
      name: packData.name,
      list: packData.listUri,
      feeds: packData.feeds,
      createdAt: packData.createdAt.toISOString(),
    };
    if (packData.description) record.description = packData.description;

    const starterPackView: {
      uri: string;
      cid: string;
      record: typeof record;
      creator: typeof creatorView;
      indexedAt: string;
      list?: { uri: string; cid: string; name: string; purpose: string };
    } = {
      uri: packData.uri,
      cid: packData.cid,
      record,
      creator: creatorView,
      indexedAt: packData.indexedAt.toISOString(),
    };

    if (list) {
      const listData = list as {
        uri: string;
        cid: string;
        name: string;
        purpose: string;
      };
      starterPackView.list = {
        uri: listData.uri,
        cid: listData.cid,
        name: listData.name,
        purpose: listData.purpose,
      };
    }

    res.json({ starterPack: starterPackView });
  } catch (error) {
    handleError(res, error, 'getStarterPack');
  }
}

/**
 * Get multiple starter packs by URIs
 * GET /xrpc/app.bsky.graph.getStarterPacks
 */
export async function getStarterPacks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getStarterPacksSchema.parse(req.query);

    const packs = await storage.getStarterPacks(params.uris);

    // Creator profiles should be available from firehose events
    const views = await Promise.all(
      (
        packs as {
          creatorDid: string;
          listUri?: string;
          name: string;
          description?: string;
          feeds?: unknown[];
          uri: string;
          cid: string;
          createdAt: Date;
          indexedAt: Date;
        }[]
      ).map(async (pack) => {
        const creator = await storage.getUser(pack.creatorDid);

        // Skip packs from creators without valid handles
        if (!creator || !(creator as { handle?: string }).handle) {
          console.warn(
            `[XRPC] Skipping starter pack ${pack.uri} - creator ${pack.creatorDid} has no handle`
          );
          return null;
        }

        const creatorData = creator as {
          handle: string;
          displayName?: string;
          avatarUrl?: string;
          did: string;
        };

        let list = null;
        if (pack.listUri) {
          list = await storage.getList(pack.listUri);
        }

        const creatorView: {
          did: string;
          handle: string;
          displayName?: string;
          avatar?: string;
        } = {
          did: pack.creatorDid,
          handle: creatorData.handle,
        };
        if (creatorData.displayName)
          creatorView.displayName = creatorData.displayName;
        if (creatorData.avatarUrl) {
          const avatarUri = transformBlobToCdnUrl(
            creatorData.avatarUrl,
            creatorData.did,
            'avatar',
            req
          );
          if (
            avatarUri &&
            typeof avatarUri === 'string' &&
            avatarUri.trim() !== ''
          ) {
            creatorView.avatar = avatarUri;
          }
        }

        const record: {
          name: string;
          list?: string;
          feeds?: unknown[];
          createdAt: string;
          description?: string;
        } = {
          name: pack.name,
          list: pack.listUri,
          feeds: pack.feeds,
          createdAt: pack.createdAt.toISOString(),
        };
        if (pack.description) record.description = pack.description;

        const view: {
          uri: string;
          cid: string;
          record: typeof record;
          creator: typeof creatorView;
          indexedAt: string;
          list?: { uri: string; cid: string; name: string; purpose: string };
        } = {
          uri: pack.uri,
          cid: pack.cid,
          record,
          creator: creatorView,
          indexedAt: pack.indexedAt.toISOString(),
        };

        if (list) {
          const listData = list as {
            uri: string;
            cid: string;
            name: string;
            purpose: string;
          };
          view.list = {
            uri: listData.uri,
            cid: listData.cid,
            name: listData.name,
            purpose: listData.purpose,
          };
        }

        return view;
      })
    );

    // Filter out null entries (packs from creators without valid handles)
    const validViews = views.filter((view) => view !== null);

    res.json({ starterPacks: validViews });
  } catch (error) {
    handleError(res, error, 'getStarterPacks');
  }
}

/**
 * Get starter packs created by an actor
 * GET /xrpc/app.bsky.graph.getActorStarterPacks
 */
export async function getActorStarterPacks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getActorStarterPacksSchema.parse(req.query);
    const did = await resolveActor(res, params.actor);
    if (!did) return;
    const { starterPacks, cursor } = await storage.getStarterPacksByCreator(
      did,
      params.limit,
      params.cursor
    );
    res.json({
      cursor,
      starterPacks: (
        starterPacks as {
          uri: string;
          cid: string;
          name: string;
          listUri?: string;
          feeds?: unknown[];
          createdAt: Date;
        }[]
      ).map((p) => ({
        uri: p.uri,
        cid: p.cid,
        record: {
          name: p.name,
          list: p.listUri,
          feeds: p.feeds,
          createdAt: p.createdAt.toISOString(),
        },
      })),
      feeds: [],
    });
  } catch (error) {
    handleError(res, error, 'getActorStarterPacks');
  }
}

/**
 * Get starter packs with membership info
 * GET /xrpc/app.bsky.graph.getStarterPacksWithMembership
 */
export async function getStarterPacksWithMembership(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getStarterPacksWithMembershipSchema.parse(req.query);
    const did = params.actor ? await resolveActor(res, params.actor) : null;
    const { starterPacks, cursor } = did
      ? await storage.getStarterPacksByCreator(did, params.limit, params.cursor)
      : await storage.listStarterPacks(params.limit, params.cursor);
    res.json({
      cursor,
      starterPacks: (starterPacks as { uri: string; cid: string }[]).map(
        (p) => ({ uri: p.uri, cid: p.cid })
      ),
    });
  } catch (error) {
    handleError(res, error, 'getStarterPacksWithMembership');
  }
}

/**
 * Get suggested starter packs for onboarding
 * GET /xrpc/app.bsky.unspecced.getOnboardingSuggestedStarterPacks
 */
export async function getOnboardingSuggestedStarterPacks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Return recent starter packs as onboarding suggestions
    const { starterPacks } = await storage.listStarterPacks(10);
    res.json({
      starterPacks: (
        starterPacks as { uri: string; cid: string; createdAt: Date }[]
      ).map((p) => ({
        uri: p.uri,
        cid: p.cid,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    handleError(res, error, 'getOnboardingSuggestedStarterPacks');
  }
}
