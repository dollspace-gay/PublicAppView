/**
 * Search Service
 * Handles search for posts, actors, and starter packs
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { searchService } from '../../search';
import { getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { maybeAvatar, serializePostsEnhanced } from '../utils/serializers';
import {
  searchActorsSchema,
  searchActorsTypeaheadSchema,
} from '../schemas/actor-schemas';
import { searchPostsSchema } from '../schemas/search-schemas';
import { searchStarterPacksSchema } from '../schemas/starter-pack-schemas';
import type { PostModel, PostView, UserModel } from '../types';

/**
 * Serialize posts with optional enhanced hydration
 */
async function serializePosts(
  posts: PostModel[],
  viewerDid?: string,
  req?: Request
): Promise<PostView[]> {
  const useEnhancedHydration =
    process.env.ENHANCED_HYDRATION_ENABLED === 'true';

  if (useEnhancedHydration) {
    return serializePostsEnhanced(posts, viewerDid, req) as Promise<PostView[]>;
  }

  // For now, use enhanced serialization as default
  return serializePostsEnhanced(posts, viewerDid, req) as Promise<PostView[]>;
}

/**
 * Search for posts
 * GET /xrpc/app.bsky.feed.searchPosts
 */
export async function searchPosts(req: Request, res: Response): Promise<void> {
  try {
    const params = searchPostsSchema.parse(req.query);

    // Validate query is not empty/whitespace only
    if (!params.q.trim()) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'query string cannot be empty',
      });
      return;
    }

    const viewerDid = await getAuthenticatedDid(req);

    const { posts, cursor } = await searchService.searchPosts(
      params.q,
      {
        limit: params.limit,
        cursor: params.cursor,
        sort: params.sort || 'top',
        since: params.since,
        until: params.until,
        mentions: params.mentions,
        author: params.author,
        lang: params.lang,
        domain: params.domain,
        url: params.url,
        tag: params.tag,
      },
      viewerDid || undefined
    );

    const serialized = await serializePosts(posts, viewerDid || undefined, req);

    res.json({ posts: serialized, cursor });
  } catch (error) {
    handleError(res, error, 'searchPosts');
  }
}

/**
 * Search for actors (users)
 * GET /xrpc/app.bsky.actor.searchActors
 */
export async function searchActors(req: Request, res: Response): Promise<void> {
  try {
    const params = searchActorsSchema.parse(req.query);
    const term = (params.q || params.term)!;

    // Validate query is not empty/whitespace only
    if (!term.trim()) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'query string cannot be empty',
      });
      return;
    }

    const viewerDid = await getAuthenticatedDid(req);

    const { actors, cursor } = await searchService.searchActors(
      term,
      params.limit,
      params.cursor
    );

    type ActorSearchResult = { did: string };
    const actorResults = actors as ActorSearchResult[];
    const dids = actorResults.map((a) => a.did);
    const users: UserModel[] = await storage.getUsers(dids);
    const userMap = new Map(users.map((u) => [u.did, u]));

    // Get viewer relationships if authenticated
    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, dids)
      : new Map();

    const results = actorResults.map((a) => {
      const u = userMap.get(a.did);

      // If user profile not found, create minimal profile with DID
      if (!u) {
        return {
          $type: 'app.bsky.actor.defs#profileView',
          did: a.did,
          handle: a.did, // Use DID as fallback
          displayName: a.did,
          viewer: {
            muted: false,
            blockedBy: false,
          },
        };
      }

      const viewerState = viewerDid ? relationships.get(u.did) : null;
      const viewer: {
        muted: boolean;
        blockedBy: boolean;
        blocking?: string;
        following?: string;
        followedBy?: string;
      } = {
        muted: viewerState ? !!viewerState.muting : false,
        blockedBy: viewerState?.blockedBy || false,
      };
      if (viewerState?.blocking) viewer.blocking = viewerState.blocking;
      if (viewerState?.following) viewer.following = viewerState.following;
      if (viewerState?.followedBy) viewer.followedBy = viewerState.followedBy;

      return {
        $type: 'app.bsky.actor.defs#profileView',
        did: u.did,
        handle: u.handle,
        displayName: u.displayName,
        description: u.description,
        ...maybeAvatar(u.avatarUrl, u.did, req),
        indexedAt: u.indexedAt?.toISOString(),
        viewer,
      };
    });

    res.json({ actors: results, cursor });
  } catch (error) {
    handleError(res, error, 'searchActors');
  }
}

/**
 * Search actors with typeahead
 * GET /xrpc/app.bsky.actor.searchActorsTypeahead
 */
export async function searchActorsTypeahead(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = searchActorsTypeaheadSchema.parse(req.query);
    const term = (params.q || params.term)!;

    // Validate query is not empty/whitespace only
    if (!term.trim()) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'query string cannot be empty',
      });
      return;
    }

    const viewerDid = await getAuthenticatedDid(req);

    const results = await searchService.searchActorsTypeahead(term, params.limit);

    // Get viewer relationships if authenticated
    const dids = results.map((r) => r.did);
    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, dids)
      : new Map();

    // Transform to proper profileViewBasic
    const actors = results.map((actor) => {
      const viewerState = viewerDid ? relationships.get(actor.did) : null;
      const viewer: {
        muted: boolean;
        blockedBy: boolean;
        blocking?: string;
        following?: string;
        followedBy?: string;
      } = {
        muted: viewerState ? !!viewerState.muting : false,
        blockedBy: viewerState?.blockedBy || false,
      };
      if (viewerState?.blocking) viewer.blocking = viewerState.blocking;
      if (viewerState?.following) viewer.following = viewerState.following;
      if (viewerState?.followedBy) viewer.followedBy = viewerState.followedBy;

      return {
        $type: 'app.bsky.actor.defs#profileViewBasic',
        did: actor.did,
        handle: actor.handle,
        displayName: actor.displayName,
        ...maybeAvatar(actor.avatarUrl, actor.did, req),
        viewer,
      };
    });

    res.json({ actors });
  } catch (error) {
    handleError(res, error, 'searchActorsTypeahead');
  }
}

/**
 * Search for starter packs
 * GET /xrpc/app.bsky.graph.searchStarterPacks
 */
export async function searchStarterPacks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = searchStarterPacksSchema.parse(req.query);
    const { starterPacks, cursor } = await storage.searchStarterPacks(
      params.q,
      params.limit,
      params.cursor
    );

    res.json({
      starterPacks: starterPacks.map((sp) => ({
        uri: (sp as { uri: string }).uri,
        cid: (sp as { cid: string }).cid,
        creator: (sp as { creator: { did: string; handle: string } }).creator,
        name: (sp as { name: string }).name,
        description: (sp as { description?: string }).description,
        createdAt: (sp as { createdAt: Date }).createdAt.toISOString(),
      })),
      cursor,
    });
  } catch (error) {
    handleError(res, error, 'searchStarterPacks');
  }
}
