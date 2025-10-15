/**
 * Search Service
 * Handles search for posts, actors, and starter packs
 */

import type { Request, Response } from 'express';
import { storage } from '../../storage';
import { searchService } from '../../search';
import { getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { maybeAvatar, serializePostsEnhanced } from '../utils/serializers';
import {
  searchPostsSchema,
  searchActorsSchema,
  searchActorsTypeaheadSchema,
} from '../schemas/actor-schemas';
import { searchStarterPacksSchema } from '../schemas/starter-pack-schemas';

/**
 * Serialize posts with optional enhanced hydration
 */
async function serializePosts(
  posts: unknown[],
  viewerDid?: string,
  req?: Request
): Promise<unknown[]> {
  const useEnhancedHydration =
    process.env.ENHANCED_HYDRATION_ENABLED === 'true';

  if (useEnhancedHydration) {
    return serializePostsEnhanced(posts, viewerDid, req);
  }

  // For now, use enhanced serialization as default
  return serializePostsEnhanced(posts, viewerDid, req);
}

/**
 * Search for posts
 * GET /xrpc/app.bsky.feed.searchPosts
 */
export async function searchPosts(req: Request, res: Response): Promise<void> {
  try {
    const params = searchPostsSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    const { posts, cursor } = await searchService.searchPosts(
      params.q,
      params.limit,
      params.cursor,
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

    const { actors, cursor } = await searchService.searchActors(
      term,
      params.limit,
      params.cursor
    );

    const dids = actors.map((a) => (a as { did: string }).did);
    const users = await storage.getUsers(dids);
    const userMap = new Map(users.map((u) => [u.did, u]));

    const results = actors
      .map((a) => {
        const actor = a as { did: string };
        const u = userMap.get(actor.did);
        if (!u) return null;
        return {
          did: u.did,
          handle: u.handle,
          displayName: u.displayName,
          ...maybeAvatar(u.avatarUrl, u.did, req),
        };
      })
      .filter(Boolean);

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
    const results = await searchService.searchActorsTypeahead(
      (params.q || params.term)!,
      params.limit
    );

    res.json({ actors: results });
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
