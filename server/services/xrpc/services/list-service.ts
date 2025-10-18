/**
 * List Service
 * Handles user list queries and list feed operations
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import {
  getListSchema,
  getListsSchema,
  getListFeedSchema,
  getListsWithMembershipSchema,
  getListMutesSchema,
  getListBlocksSchema,
} from '../schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Convert list avatar CID to CDN URL
 * Returns undefined if avatar is missing or invalid
 * Matches the official Bluesky AppView behavior
 */
function getListAvatarUrl(
  avatarCid: string | null | undefined,
  creatorDid: string,
  req?: Request
): string | undefined {
  if (!avatarCid || typeof avatarCid !== 'string') return undefined;
  const trimmed = avatarCid.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return undefined;

  // If already a full URL, return as-is
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Transform CID to CDN URL using the same helper as feed generators
  const { transformBlobToCdnUrl } = require('../utils/serializers');
  return transformBlobToCdnUrl(avatarCid, creatorDid, 'avatar', req);
}

/**
 * Get a specific list by URI with items
 * GET /xrpc/app.bsky.graph.getList
 */
export async function getList(req: Request, res: Response): Promise<void> {
  try {
    const params = getListSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    // Get list metadata
    let list = await storage.getList(params.list);

    if (!list) {
      // Try to discover the list from PDS
      console.log(`[XRPC] List not found in database, attempting discovery: ${params.list}`);

      try {
        // Parse the URI to get the creator DID
        const parts = params.list.split('/');
        const creatorDid = parts[2];
        const rkey = parts[4];

        // Ensure the creator user exists first
        const creator = await storage.getUser(creatorDid);
        if (!creator) {
          console.log(`[XRPC] Creator ${creatorDid} not found, creating placeholder`);
          await storage.createUser({
            did: creatorDid,
            handle: 'handle.invalid', // Will be updated by PDS fetcher
          });
        }

        // Fetch list from creator's PDS
        const { didResolver } = await import('../../did-resolver');
        const pdsUrl = await didResolver.resolveDIDToPDS(creatorDid);

        if (pdsUrl) {
          const recordUrl = `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(creatorDid)}&collection=app.bsky.graph.list&rkey=${encodeURIComponent(rkey)}`;
          const response = await fetch(recordUrl, {
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            const { value, cid } = await response.json();
            console.log(`[XRPC] List discovered, indexing: ${value.name}`);

            // Process through event processor to index it
            const { eventProcessor } = await import('../../event-processor');
            const listRecord: any = {
              $type: 'app.bsky.graph.list',
              name: value.name,
              purpose: value.purpose,
              description: value.description,
              createdAt: value.createdAt,
            };
            // Only include avatar if it's a valid blob reference
            if (value.avatar && typeof value.avatar === 'object' && value.avatar.ref) {
              listRecord.avatar = value.avatar;
            }
            await eventProcessor.processRecord(params.list, cid, creatorDid, listRecord);

            // Try fetching again after indexing
            list = await storage.getList(params.list);
          }
        }
      } catch (error) {
        console.warn(`[XRPC] Failed to discover list:`, error);
      }

      if (!list) {
        res.status(404).json({
          error: 'NotFound',
          message: 'List not found',
        });
        return;
      }
    }

    // Get list items with pagination
    const { items: listItems, cursor: nextCursor } =
      await storage.getListItemsWithPagination(
        params.list,
        params.limit,
        params.cursor
      );

    // Hydrate creator profile
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      [list.creatorDid],
      req
    );
    const creator = creatorProfiles[0];

    if (!creator) {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Failed to fetch list creator profile',
      });
      return;
    }

    // Hydrate subject profiles for list items
    const subjectDids = listItems.map((item) => item.subjectDid);
    let subjects: any[] = [];

    if (subjectDids.length > 0) {
      subjects = await (xrpcApi as any)._getProfiles(subjectDids, req);
    }

    // Create subject map for quick lookup
    const subjectMap = new Map(subjects.map((s) => [s.did, s]));

    // Build list item views
    const itemViews = listItems
      .map((item) => {
        const subject = subjectMap.get(item.subjectDid);
        if (!subject) return null;

        return {
          uri: item.uri,
          subject,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // Count total list items (for listItemCount field)
    const allItems = await storage.getListItems(params.list, 10000);
    const listItemCount = allItems.length;

    // Build viewer state if authenticated
    let viewer: any = undefined;
    if (viewerDid) {
      // Check if viewer has muted this list
      const { mutes } = await storage.getListMutes(viewerDid, 1000, undefined);
      const isMuted = mutes.some((m) => m.listUri === params.list);

      // Check if viewer has blocked this list
      const { blocks } = await storage.getListBlocks(
        viewerDid,
        1000,
        undefined
      );
      const isBlocked = blocks.some((b) => b.listUri === params.list);

      if (isMuted || isBlocked) {
        viewer = {
          muted: isMuted || undefined,
          blocked: isBlocked ? params.list : undefined,
        };
      }
    }

    // Build ATProto-compliant response
    const avatarUrl = getListAvatarUrl(list.avatarUrl, list.creatorDid, req);

    res.json({
      cursor: nextCursor,
      list: {
        uri: list.uri,
        cid: list.cid,
        creator,
        name: list.name,
        purpose: list.purpose,
        description: list.description || undefined,
        ...(avatarUrl && { avatar: avatarUrl }),
        listItemCount,
        indexedAt: list.indexedAt.toISOString(),
        ...(viewer && { viewer }),
      },
      items: itemViews,
    });
  } catch (error) {
    handleError(res, error, 'getList');
  }
}

/**
 * Get lists created by an actor
 * GET /xrpc/app.bsky.graph.getLists
 */
export async function getLists(req: Request, res: Response): Promise<void> {
  try {
    const params = getListsSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    // Resolve actor to DID
    const did = await resolveActor(res, params.actor);
    if (!did) return;

    // Get lists with pagination and optional purpose filtering
    const { lists: userLists, cursor: nextCursor } =
      await storage.getUserListsWithPagination(
        did,
        params.limit,
        params.cursor,
        params.purposes
      );

    if (userLists.length === 0) {
      res.json({
        cursor: nextCursor,
        lists: [],
      });
      return;
    }

    // Hydrate creator profile for all lists (should be same creator)
    const creatorProfiles = await (xrpcApi as any)._getProfiles([did], req);
    const creator = creatorProfiles[0];

    if (!creator) {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Failed to fetch list creator profile',
      });
      return;
    }

    // Build viewer states if authenticated
    let viewerMutes: Set<string> = new Set();
    let viewerBlocks: Set<string> = new Set();

    if (viewerDid) {
      const { mutes } = await storage.getListMutes(viewerDid, 1000, undefined);
      viewerMutes = new Set(mutes.map((m) => m.listUri));

      const { blocks } = await storage.getListBlocks(
        viewerDid,
        1000,
        undefined
      );
      viewerBlocks = new Set(blocks.map((b) => b.listUri));
    }

    // Get list item counts for all lists
    const listItemCounts = await Promise.all(
      userLists.map(async (list) => {
        const items = await storage.getListItems(list.uri, 10000);
        return { uri: list.uri, count: items.length };
      })
    );
    const countMap = new Map(listItemCounts.map((c) => [c.uri, c.count]));

    // Build full listView objects
    const listViews = userLists.map((list) => {
      const listItemCount = countMap.get(list.uri) || 0;

      // Build viewer state if authenticated
      let viewer: any = undefined;
      if (viewerDid) {
        const isMuted = viewerMutes.has(list.uri);
        const isBlocked = viewerBlocks.has(list.uri);

        if (isMuted || isBlocked) {
          viewer = {
            muted: isMuted || undefined,
            blocked: isBlocked ? list.uri : undefined,
          };
        }
      }

      return {
        uri: list.uri,
        cid: list.cid,
        creator,
        name: list.name,
        purpose: list.purpose,
        description: list.description || undefined,
        ...(getListAvatarUrl(list.avatarUrl, list.creatorDid, req) && { avatar: getListAvatarUrl(list.avatarUrl, list.creatorDid, req) }),
        listItemCount,
        indexedAt: list.indexedAt.toISOString(),
        ...(viewer && { viewer }),
      };
    });

    res.json({
      cursor: nextCursor,
      lists: listViews,
    });
  } catch (error) {
    handleError(res, error, 'getLists');
  }
}

/**
 * Get feed of posts from a list
 * GET /xrpc/app.bsky.feed.getListFeed
 */
export async function getListFeed(req: Request, res: Response): Promise<void> {
  try {
    const params = getListFeedSchema.parse(req.query);

    // Check if list exists (ATProto spec requires UnknownList error)
    let list = await storage.getList(params.list);

    if (!list) {
      // Try to discover the list from PDS
      console.log(`[XRPC] List not found for feed, attempting discovery: ${params.list}`);

      try {
        // Parse the URI to get the creator DID
        const parts = params.list.split('/');
        const creatorDid = parts[2];
        const rkey = parts[4];

        // Ensure the creator user exists first
        const creator = await storage.getUser(creatorDid);
        if (!creator) {
          console.log(`[XRPC] Creator ${creatorDid} not found, creating placeholder`);
          await storage.createUser({
            did: creatorDid,
            handle: 'handle.invalid', // Will be updated by PDS fetcher
          });
        }

        // Fetch list from creator's PDS
        const { didResolver } = await import('../../did-resolver');
        const pdsUrl = await didResolver.resolveDIDToPDS(creatorDid);

        if (pdsUrl) {
          const recordUrl = `${pdsUrl}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(creatorDid)}&collection=app.bsky.graph.list&rkey=${encodeURIComponent(rkey)}`;
          const response = await fetch(recordUrl, {
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            const { value, cid } = await response.json();
            console.log(`[XRPC] List discovered, indexing: ${value.name}`);

            // Process through event processor to index it
            const { eventProcessor } = await import('../../event-processor');
            const listRecord: any = {
              $type: 'app.bsky.graph.list',
              name: value.name,
              purpose: value.purpose,
              description: value.description,
              createdAt: value.createdAt,
            };
            // Only include avatar if it's a valid blob reference
            if (value.avatar && typeof value.avatar === 'object' && value.avatar.ref) {
              listRecord.avatar = value.avatar;
            }
            await eventProcessor.processRecord(params.list, cid, creatorDid, listRecord);

            // Try fetching again after indexing
            list = await storage.getList(params.list);
          }
        }
      } catch (error) {
        console.warn(`[XRPC] Failed to discover list:`, error);
      }

      if (!list) {
        res.status(400).json({
          error: 'UnknownList',
          message: 'List not found',
        });
        return;
      }
    }

    // Fetch posts from list members with limit+1 for pagination
    const posts = await storage.getListFeed(
      params.list,
      params.limit,
      params.cursor
    );

    const viewerDid = await getAuthenticatedDid(req);

    // Use serializePosts for proper post hydration with viewer context
    // This handles: embeds, author profiles, viewer state (likes/reposts),
    // reply counts, repost counts, quote counts, labels, and thread context
    const serialized = await (xrpcApi as any).serializePosts(
      posts,
      viewerDid || undefined,
      req
    );

    // Generate cursor from last post if results exist
    const cursor =
      posts.length > 0
        ? posts[posts.length - 1].indexedAt.toISOString()
        : undefined;

    res.json({
      cursor,
      feed: serialized.map((p: any) => ({ post: p })),
    });
  } catch (error) {
    handleError(res, error, 'getListFeed');
  }
}

/**
 * Get lists with membership information for an actor
 * GET /xrpc/app.bsky.graph.getListsWithMembership
 *
 * Returns lists created by the authenticated user, with membership info
 * about the specified actor in each list.
 */
export async function getListsWithMembership(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getListsWithMembershipSchema.parse(req.query);

    // Requires authentication - lists are created by session user
    const sessionDid = await requireAuthDid(req, res);
    if (!sessionDid) return;

    // Resolve the actor to check for membership
    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    // Get lists created by authenticated user with pagination and optional filtering
    const { lists: userLists, cursor: nextCursor } =
      await storage.getUserListsWithPagination(
        sessionDid,
        params.limit,
        params.cursor,
        params.purposes
      );

    if (userLists.length === 0) {
      res.json({
        cursor: nextCursor,
        listsWithMembership: [],
      });
      return;
    }

    // Get creator profile (session user)
    const creator = await storage.getUser(sessionDid);
    if (!creator || !(creator as { handle?: string }).handle) {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Creator profile not available',
      });
      return;
    }

    const creatorData = creator as {
      handle: string;
      displayName?: string;
      avatarUrl?: string;
      did: string;
    };

    // Build creator ProfileView (will be same for all lists)
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      [sessionDid],
      req
    );
    const creatorView = creatorProfiles[0];

    if (!creatorView) {
      res.status(500).json({
        error: 'InternalServerError',
        message: 'Failed to fetch creator profile',
      });
      return;
    }

    // Get all list URIs to check membership
    const listUris = userLists.map((l) => l.uri);

    // Batch fetch list items to check membership
    const membershipPromises = listUris.map(async (listUri) => {
      const items = await storage.getListItems(listUri, 10000);
      return { listUri, items };
    });
    const membershipResults = await Promise.all(membershipPromises);
    const membershipMap = new Map(
      membershipResults.map((r) => [r.listUri, r.items])
    );

    // Get actor profile for listItem views
    const actorProfiles = await (xrpcApi as any)._getProfiles([actorDid], req);
    const actorProfile = actorProfiles[0];

    // Batch fetch list item counts
    const listItemCounts = await Promise.all(
      userLists.map(async (list) => {
        const items = await storage.getListItems(list.uri, 10000);
        return { uri: list.uri, count: items.length };
      })
    );
    const countMap = new Map(listItemCounts.map((c) => [c.uri, c.count]));

    // Build viewer states if needed
    const viewerDid = sessionDid;
    const { mutes } = await storage.getListMutes(viewerDid, 1000, undefined);
    const viewerMutes = new Set(mutes.map((m) => m.listUri));

    const { blocks } = await storage.getListBlocks(viewerDid, 1000, undefined);
    const viewerBlocks = new Set(blocks.map((b) => b.listUri));

    // Build listsWithMembership response
    const listsWithMembership = userLists.map((list) => {
      const listItemCount = countMap.get(list.uri) || 0;

      // Build viewer state
      let viewer: any = undefined;
      const isMuted = viewerMutes.has(list.uri);
      const isBlocked = viewerBlocks.has(list.uri);

      if (isMuted || isBlocked) {
        viewer = {
          muted: isMuted || undefined,
          blocked: isBlocked ? list.uri : undefined,
        };
      }

      // Build full listView
      const listView = {
        uri: list.uri,
        cid: list.cid,
        creator: creatorView,
        name: list.name,
        purpose: list.purpose,
        description: list.description || undefined,
        ...(getListAvatarUrl(list.avatarUrl, list.creatorDid, req) && { avatar: getListAvatarUrl(list.avatarUrl, list.creatorDid, req) }),
        listItemCount,
        indexedAt: list.indexedAt.toISOString(),
        ...(viewer && { viewer }),
      };

      // Check if actor is a member of this list
      const listItems = membershipMap.get(list.uri) || [];
      const memberItem = listItems.find((item) => item.subjectDid === actorDid);

      // Build response object
      const response: {
        list: typeof listView;
        listItem?: { uri: string; subject: any };
      } = {
        list: listView,
      };

      // Include listItem if actor is a member
      if (memberItem && actorProfile) {
        response.listItem = {
          uri: memberItem.uri,
          subject: actorProfile,
        };
      }

      return response;
    });

    res.json({
      cursor: nextCursor,
      listsWithMembership,
    });
  } catch (error) {
    handleError(res, error, 'getListsWithMembership');
  }
}

/**
 * Get lists that the authenticated user has muted
 * GET /xrpc/app.bsky.graph.getListMutes
 */
export async function getListMutes(req: Request, res: Response): Promise<void> {
  try {
    const params = getListMutesSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get muted list URIs with pagination
    const { mutes, cursor: nextCursor } = await storage.getListMutes(
      userDid,
      params.limit,
      params.cursor
    );

    if (mutes.length === 0) {
      res.json({
        cursor: nextCursor,
        lists: [],
      });
      return;
    }

    // Batch fetch all muted lists
    const listUris = mutes.map((m) => m.listUri);
    const lists = await Promise.all(
      listUris.map((uri) => storage.getList(uri))
    );

    // Filter out nulls (lists that no longer exist)
    const existingLists = lists.filter(
      (list): list is NonNullable<typeof list> => list !== null
    );

    if (existingLists.length === 0) {
      res.json({
        cursor: nextCursor,
        lists: [],
      });
      return;
    }

    // Get unique creator DIDs
    const creatorDids = [
      ...new Set(existingLists.map((list) => list.creatorDid)),
    ];

    // Batch fetch all creator profiles
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );
    const creatorMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Batch fetch list item counts
    const listItemCounts = await Promise.all(
      existingLists.map(async (list) => {
        const items = await storage.getListItems(list.uri, 10000);
        return { uri: list.uri, count: items.length };
      })
    );
    const countMap = new Map(listItemCounts.map((c) => [c.uri, c.count]));

    // Build full listView objects
    const listViews = existingLists
      .map((list) => {
        const creator = creatorMap.get(list.creatorDid);
        if (!creator) return null;

        const listItemCount = countMap.get(list.uri) || 0;

        // All these lists are muted by the viewer (by definition)
        const viewer = {
          muted: true,
        };

        return {
          uri: list.uri,
          cid: list.cid,
          creator,
          name: list.name,
          purpose: list.purpose,
          description: list.description || undefined,
          ...(list.avatarUrl && typeof list.avatarUrl === 'string' && list.avatarUrl.trim() !== '' && { avatar: list.avatarUrl }),
          listItemCount,
          indexedAt: list.indexedAt.toISOString(),
          viewer,
        };
      })
      .filter((list): list is NonNullable<typeof list> => list !== null);

    res.json({
      cursor: nextCursor,
      lists: listViews,
    });
  } catch (error) {
    handleError(res, error, 'getListMutes');
  }
}

/**
 * Get lists that the authenticated user has blocked
 * GET /xrpc/app.bsky.graph.getListBlocks
 */
export async function getListBlocks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getListBlocksSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get blocked list URIs with pagination
    const { blocks, cursor: nextCursor } = await storage.getListBlocks(
      userDid,
      params.limit,
      params.cursor
    );

    if (blocks.length === 0) {
      res.json({
        cursor: nextCursor,
        lists: [],
      });
      return;
    }

    // Batch fetch all blocked lists
    const listUris = blocks.map((b) => b.listUri);
    const lists = await Promise.all(
      listUris.map((uri) => storage.getList(uri))
    );

    // Filter out nulls (lists that no longer exist)
    const existingLists = lists.filter(
      (list): list is NonNullable<typeof list> => list !== null
    );

    if (existingLists.length === 0) {
      res.json({
        cursor: nextCursor,
        lists: [],
      });
      return;
    }

    // Get unique creator DIDs
    const creatorDids = [
      ...new Set(existingLists.map((list) => list.creatorDid)),
    ];

    // Batch fetch all creator profiles
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );
    const creatorMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Batch fetch list item counts
    const listItemCounts = await Promise.all(
      existingLists.map(async (list) => {
        const items = await storage.getListItems(list.uri, 10000);
        return { uri: list.uri, count: items.length };
      })
    );
    const countMap = new Map(listItemCounts.map((c) => [c.uri, c.count]));

    // Build full listView objects
    const listViews = existingLists
      .map((list) => {
        const creator = creatorMap.get(list.creatorDid);
        if (!creator) return null;

        const listItemCount = countMap.get(list.uri) || 0;

        // All these lists are blocked by the viewer (by definition)
        const viewer = {
          blocked: list.uri,
        };

        return {
          uri: list.uri,
          cid: list.cid,
          creator,
          name: list.name,
          purpose: list.purpose,
          description: list.description || undefined,
          ...(list.avatarUrl && typeof list.avatarUrl === 'string' && list.avatarUrl.trim() !== '' && { avatar: list.avatarUrl }),
          listItemCount,
          indexedAt: list.indexedAt.toISOString(),
          viewer,
        };
      })
      .filter((list): list is NonNullable<typeof list> => list !== null);

    res.json({
      cursor: nextCursor,
      lists: listViews,
    });
  } catch (error) {
    handleError(res, error, 'getListBlocks');
  }
}
