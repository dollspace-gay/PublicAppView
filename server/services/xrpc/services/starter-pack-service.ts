/**
 * Starter Pack Service
 * Handles starter pack queries and discovery
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import { requireAuthDid } from '../utils/auth-helpers';
import { transformBlobToCdnUrl } from '../utils/serializers';
import {
  getStarterPackSchema,
  getStarterPacksSchema,
  getActorStarterPacksSchema,
  getStarterPacksWithMembershipSchema,
  getOnboardingSuggestedStarterPacksSchema,
} from '../schemas';
import { xrpcApi } from '../../xrpc-api';

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

    // Use _getProfiles for complete creator profileViewBasic
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      [packData.creatorDid],
      req
    );

    if (creatorProfiles.length === 0) {
      return res.status(500).json({
        error: 'Starter pack creator profile not available',
        message: 'Unable to load creator information',
      });
    }

    // Build starter pack view
    const starterPackView: any = {
      uri: packData.uri,
      cid: packData.cid,
      record: {
        name: packData.name,
        list: packData.listUri,
        feeds: packData.feeds,
        createdAt: packData.createdAt.toISOString(),
        ...(packData.description && { description: packData.description }),
      },
      creator: creatorProfiles[0], // Full profileViewBasic
      indexedAt: packData.indexedAt.toISOString(),
    };

    // Add optional list info if exists
    if (packData.listUri) {
      const list = await storage.getList(packData.listUri);
      if (list) {
        starterPackView.list = {
          uri: list.uri,
          cid: list.cid,
          name: list.name,
          purpose: list.purpose,
        };
      }
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

    const packs = (await storage.getStarterPacks(params.uris)) as {
      creatorDid: string;
      listUri?: string;
      name: string;
      description?: string;
      feeds?: unknown[];
      uri: string;
      cid: string;
      createdAt: Date;
      indexedAt: Date;
    }[];

    if (packs.length === 0) {
      return res.json({ starterPacks: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(packs.map((p) => p.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Build views with complete creator profiles
    const views = await Promise.all(
      packs.map(async (pack) => {
        const creatorProfile = profileMap.get(pack.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping starter pack ${pack.uri} - creator ${pack.creatorDid} profile not found`
          );
          return null;
        }

        const view: any = {
          uri: pack.uri,
          cid: pack.cid,
          record: {
            name: pack.name,
            list: pack.listUri,
            feeds: pack.feeds,
            createdAt: pack.createdAt.toISOString(),
            ...(pack.description && { description: pack.description }),
          },
          creator: creatorProfile, // Full profileViewBasic
          indexedAt: pack.indexedAt.toISOString(),
        };

        // Add optional list info if exists
        if (pack.listUri) {
          const list = await storage.getList(pack.listUri);
          if (list) {
            view.list = {
              uri: list.uri,
              cid: list.cid,
              name: list.name,
              purpose: list.purpose,
            };
          }
        }

        return view;
      })
    );

    const validViews = views.filter(Boolean);

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

    const { starterPacks, cursor: nextCursor } =
      await storage.getStarterPacksByCreator(did, params.limit, params.cursor);

    if (starterPacks.length === 0) {
      res.json({
        cursor: nextCursor,
        starterPacks: [],
      });
      return;
    }

    // Use _getProfiles for complete creator profileViewBasic (all packs have same creator)
    const creatorProfiles = await (xrpcApi as any)._getProfiles([did], req);

    if (creatorProfiles.length === 0) {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Creator profile not available',
      });
      return;
    }

    const creatorView = creatorProfiles[0];

    // Get all starter pack URIs for batch label fetching
    const packUris = starterPacks.map((p: any) => p.uri);

    // Batch fetch labels for all starter packs
    const allLabels = await storage.getLabelsForSubjects(packUris);
    const labelsMap = new Map<string, typeof allLabels>();

    allLabels.forEach((label) => {
      const existing = labelsMap.get(label.subject) || [];
      existing.push(label);
      labelsMap.set(label.subject, existing);
    });

    // Build starterPackViewBasic objects
    const starterPackViews = await Promise.all(
      (
        starterPacks as {
          uri: string;
          cid: string;
          name: string;
          description?: string;
          listUri?: string;
          feeds?: unknown[];
          createdAt: Date;
          indexedAt: Date;
        }[]
      ).map(async (pack) => {
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

        if (pack.description) {
          record.description = pack.description;
        }

        // Calculate listItemCount if list exists
        let listItemCount: number | undefined = undefined;
        if (pack.listUri) {
          const items = await storage.getListItems(pack.listUri, 10000);
          listItemCount = items.length;
        }

        // Get labels for this pack
        const packLabels = labelsMap.get(pack.uri);
        const labels = packLabels?.map((label) => ({
          src: label.src,
          uri: label.uri,
          val: label.val,
          cts: label.createdAt.toISOString(),
          ...(label.neg && { neg: true }),
        }));

        return {
          uri: pack.uri,
          cid: pack.cid,
          record,
          creator: creatorView,
          indexedAt: pack.indexedAt.toISOString(),
          ...(listItemCount !== undefined && { listItemCount }),
          ...(labels && labels.length > 0 && { labels }),
        };
      })
    );

    res.json({
      cursor: nextCursor,
      starterPacks: starterPackViews,
    });
  } catch (error) {
    handleError(res, error, 'getActorStarterPacks');
  }
}

/**
 * Get starter packs with membership info
 * GET /xrpc/app.bsky.graph.getStarterPacksWithMembership
 *
 * Returns starter packs created by the authenticated user, with membership info
 * about the specified actor in each pack's associated list.
 */
export async function getStarterPacksWithMembership(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getStarterPacksWithMembershipSchema.parse(req.query);

    // Requires authentication - starter packs are created by session user
    const sessionDid = await requireAuthDid(req, res);
    if (!sessionDid) return;

    // Resolve the actor to check for membership
    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    // Get starter packs created by authenticated user
    const { starterPacks, cursor: nextCursor } =
      await storage.getStarterPacksByCreator(
        sessionDid,
        params.limit,
        params.cursor
      );

    if (starterPacks.length === 0) {
      res.json({
        cursor: nextCursor,
        starterPacksWithMembership: [],
      });
      return;
    }

    // Use _getProfiles for both creator and actor profiles
    const profiles = await (xrpcApi as any)._getProfiles(
      [sessionDid, actorDid],
      req
    );

    if (profiles.length === 0) {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Profiles not available',
      });
      return;
    }

    const profileMap = new Map(profiles.map((p: any) => [p.did, p]));
    const creatorView = profileMap.get(sessionDid);
    const actorProfile = profileMap.get(actorDid);

    if (!creatorView) {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Creator profile not available',
      });
      return;
    }

    // Get all starter pack URIs for batch label fetching
    const packUris = starterPacks.map((p: any) => p.uri);

    // Batch fetch labels for all starter packs
    const allLabels = await storage.getLabelsForSubjects(packUris);
    const labelsMap = new Map<string, typeof allLabels>();

    allLabels.forEach((label) => {
      const existing = labelsMap.get(label.subject) || [];
      existing.push(label);
      labelsMap.set(label.subject, existing);
    });

    // Build starterPacksWithMembership response
    const starterPacksWithMembershipData = await Promise.all(
      (
        starterPacks as {
          uri: string;
          cid: string;
          name: string;
          description?: string;
          listUri?: string;
          feeds?: unknown[];
          createdAt: Date;
          indexedAt: Date;
        }[]
      ).map(async (pack) => {
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

        if (pack.description) {
          record.description = pack.description;
        }

        // Calculate listItemCount if list exists
        let listItemCount: number | undefined = undefined;
        let memberItem = null;

        if (pack.listUri) {
          const listItems = await storage.getListItems(pack.listUri, 10000);
          listItemCount = listItems.length;

          // Check if actor is a member of this pack's list
          memberItem = listItems.find((item) => item.subjectDid === actorDid);
        }

        // Get labels for this pack
        const packLabels = labelsMap.get(pack.uri);
        const labels = packLabels?.map((label) => ({
          src: label.src,
          uri: label.uri,
          val: label.val,
          cts: label.createdAt.toISOString(),
          ...(label.neg && { neg: true }),
        }));

        // Build full starterPackViewBasic
        const starterPackView = {
          uri: pack.uri,
          cid: pack.cid,
          record,
          creator: creatorView,
          indexedAt: pack.indexedAt.toISOString(),
          ...(listItemCount !== undefined && { listItemCount }),
          ...(labels && labels.length > 0 && { labels }),
        };

        // Build response object
        const response: {
          starterPack: typeof starterPackView;
          listItem?: { uri: string; subject: any };
        } = {
          starterPack: starterPackView,
        };

        // Include listItem if actor is a member of the pack's list
        if (memberItem && actorProfile) {
          response.listItem = {
            uri: memberItem.uri,
            subject: actorProfile,
          };
        }

        return response;
      })
    );

    res.json({
      cursor: nextCursor,
      starterPacksWithMembership: starterPacksWithMembershipData,
    });
  } catch (error) {
    handleError(res, error, 'getStarterPacksWithMembership');
  }
}

/**
 * Get suggested starter packs for onboarding
 * GET /xrpc/app.bsky.unspecced.getOnboardingSuggestedStarterPacks
 *
 * IMPORTANT: This endpoint is experimental and marked as "unspecced" in the ATProto specification.
 * Returns a list of suggested starter packs for new user onboarding with complete starterPackView objects.
 */
export async function getOnboardingSuggestedStarterPacks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getOnboardingSuggestedStarterPacksSchema.parse(req.query);

    // Return recent starter packs as onboarding suggestions
    const { starterPacks } = (await storage.listStarterPacks(params.limit)) as {
      starterPacks: {
        uri: string;
        cid: string;
        creatorDid: string;
        listUri?: string;
        name: string;
        description?: string;
        feeds?: unknown[];
        createdAt: Date;
        indexedAt: Date;
      }[];
    };

    if (starterPacks.length === 0) {
      return res.json({ starterPacks: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(starterPacks.map((p) => p.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Build views with complete creator profiles
    const views = await Promise.all(
      starterPacks.map(async (pack) => {
        const creatorProfile = profileMap.get(pack.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping starter pack ${pack.uri} - creator ${pack.creatorDid} profile not found`
          );
          return null;
        }

        const view: any = {
          uri: pack.uri,
          cid: pack.cid,
          record: {
            name: pack.name,
            list: pack.listUri,
            feeds: pack.feeds,
            createdAt: pack.createdAt.toISOString(),
            ...(pack.description && { description: pack.description }),
          },
          creator: creatorProfile, // Full profileViewBasic
          indexedAt: pack.indexedAt.toISOString(),
        };

        // Add optional list info if exists
        if (pack.listUri) {
          const list = await storage.getList(pack.listUri);
          if (list) {
            view.list = {
              uri: list.uri,
              cid: list.cid,
              name: list.name,
              purpose: list.purpose,
            };
          }
        }

        return view;
      })
    );

    const validViews = views.filter(Boolean);

    res.json({ starterPacks: validViews });
  } catch (error) {
    handleError(res, error, 'getOnboardingSuggestedStarterPacks');
  }
}
