/**
 * Post Interaction Service
 * Handles post interaction endpoints: getPosts, getLikes, getRepostedBy, getQuotes, getActorLikes
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { handleError } from '../utils/error-handler';
import { maybeAvatar } from '../utils/serializers';
import { getAuthenticatedDid } from '../utils/auth-helpers';
import {
  getPostsSchema,
  getLikesSchema,
  getRepostedBySchema,
  getQuotesSchema,
  getActorLikesSchema,
} from '../schemas/timeline-schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get multiple posts by URIs
 * GET /xrpc/app.bsky.feed.getPosts
 */
export async function getPosts(req: Request, res: Response): Promise<void> {
  try {
    const params = getPostsSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    console.log(`[getPosts] Fetching ${params.uris.length} posts`);
    const posts = await storage.getPosts(params.uris);
    console.log(`[getPosts] Found ${posts.length} posts in database`);

    if (posts.length === 0) {
      console.log(`[getPosts] No posts found for URIs:`, params.uris);
      return res.json({ posts: [] });
    }

    console.log(`[getPosts] Serializing ${posts.length} posts`);
    const serializedPosts = await (xrpcApi as any).serializePosts(
      posts,
      viewerDid || undefined,
      req
    );
    console.log(
      `[getPosts] Successfully serialized ${serializedPosts.length} posts`
    );
    res.json({ posts: serializedPosts });
  } catch (error) {
    console.error('[getPosts] Error details:', error);
    console.error(
      '[getPosts] Error stack:',
      error instanceof Error ? error.stack : 'No stack trace'
    );
    handleError(res, error, 'getPosts');
  }
}

/**
 * Get actors who liked a post
 * GET /xrpc/app.bsky.feed.getLikes
 */
export async function getLikes(req: Request, res: Response): Promise<void> {
  try {
    const params = getLikesSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    const { likes, cursor } = await storage.getPostLikes(
      params.uri,
      params.limit,
      params.cursor
    );
    const userDids = likes.map((like) => like.userDid);
    const users = await storage.getUsers(userDids);
    const userMap = new Map(users.map((u) => [u.did, u]));

    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, userDids)
      : new Map();

    res.json({
      uri: params.uri,
      cid: params.cid,
      cursor: cursor,
      likes: likes
        .map((like) => {
          const user = userMap.get(like.userDid);
          if (!user) return null;

          const viewerState = viewerDid
            ? relationships.get(like.userDid)
            : null;
          const viewer: any = {
            muted: viewerState ? !!viewerState.muting : false,
            blockedBy: viewerState?.blockedBy || false,
          };
          if (viewerState?.blocking) viewer.blocking = viewerState.blocking;
          if (viewerState?.following) viewer.following = viewerState.following;
          if (viewerState?.followedBy) viewer.followedBy = viewerState.followedBy;

          return {
            actor: {
              did: user.did,
              handle: user.handle,
              displayName: user.displayName || user.handle,
              ...maybeAvatar(user.avatarUrl, user.did, req),
              viewer,
            },
            createdAt: like.createdAt.toISOString(),
            indexedAt: like.indexedAt.toISOString(),
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    handleError(res, error, 'getLikes');
  }
}

/**
 * Get actors who reposted a post
 * GET /xrpc/app.bsky.feed.getRepostedBy
 */
export async function getRepostedBy(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getRepostedBySchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    const { reposts, cursor } = await storage.getPostReposts(
      params.uri,
      params.limit,
      params.cursor
    );
    const userDids = reposts.map((repost) => repost.userDid);
    const users = await storage.getUsers(userDids);
    const userMap = new Map(users.map((u) => [u.did, u]));

    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, userDids)
      : new Map();

    res.json({
      uri: params.uri,
      cid: params.cid,
      cursor: cursor,
      repostedBy: reposts
        .map((repost) => {
          const user = userMap.get(repost.userDid);
          if (!user) return null;

          const viewerState = viewerDid
            ? relationships.get(repost.userDid)
            : null;
          const viewer: any = {
            muted: viewerState ? !!viewerState.muting : false,
            blockedBy: viewerState?.blockedBy || false,
          };
          if (viewerState?.blocking) viewer.blocking = viewerState.blocking;
          if (viewerState?.following) viewer.following = viewerState.following;
          if (viewerState?.followedBy) viewer.followedBy = viewerState.followedBy;

          return {
            did: user.did,
            handle: user.handle,
            displayName: user.displayName || user.handle,
            ...maybeAvatar(user.avatarUrl, user.did, req),
            viewer,
            indexedAt: repost.indexedAt.toISOString(),
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    handleError(res, error, 'getRepostedBy');
  }
}

/**
 * Get quote posts of a post
 * GET /xrpc/app.bsky.feed.getQuotes
 */
export async function getQuotes(req: Request, res: Response): Promise<void> {
  try {
    const params = getQuotesSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);
    const posts = await storage.getQuotePosts(
      params.uri,
      params.limit,
      params.cursor
    );
    const serialized = await (xrpcApi as any).serializePosts(
      posts,
      viewerDid || undefined,
      req
    );
    const oldest = posts.length ? posts[posts.length - 1] : null;
    res.json({
      posts: serialized,
      cursor: oldest ? oldest.indexedAt.toISOString() : undefined,
      uri: params.uri,
      cid: params.cid,
    });
  } catch (error) {
    handleError(res, error, 'getQuotes');
  }
}

/**
 * Get posts liked by an actor
 * GET /xrpc/app.bsky.feed.getActorLikes
 */
export async function getActorLikes(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getActorLikesSchema.parse(req.query);
    const viewerDid = await getAuthenticatedDid(req);

    let actorDid = params.actor;
    if (!params.actor.startsWith('did:')) {
      const user = await storage.getUserByHandle(params.actor);
      if (!user) {
        return res.status(404).json({ error: 'Actor not found' });
      }
      actorDid = user.did;
    }

    const { likes, cursor } = await storage.getActorLikes(
      actorDid,
      params.limit,
      params.cursor
    );

    const postUris = likes.map((like) => like.postUri);
    const posts = await storage.getPosts(postUris);

    // Log if there's a mismatch between liked posts and fetched posts (for debugging)
    if (posts.length !== postUris.length) {
      const foundUris = new Set(posts.map((p) => p.uri));
      const missingUris = postUris.filter((uri) => !foundUris.has(uri));
      console.log(
        `[XRPC] getActorLikes: ${missingUris.length} liked posts not yet imported (from other users)`
      );
    }

    // Create map to preserve order from likes
    const postMap = new Map(posts.map((p) => [p.uri, p]));
    const orderedPosts = postUris
      .map((uri) => postMap.get(uri))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);

    const serialized = await (xrpcApi as any).serializePosts(
      orderedPosts,
      viewerDid || undefined,
      req
    );

    // Build feed response with like timestamps
    const feed = serialized.map((post: any, index: number) => ({
      post,
      cursor: likes[index]?.createdAt.toISOString(),
    }));

    res.json({
      feed,
      cursor: cursor,
    });
  } catch (error) {
    handleError(res, error, 'getActorLikes');
  }
}
