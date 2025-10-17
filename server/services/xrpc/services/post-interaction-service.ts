/**
 * Post Interaction Service
 * Handles post interaction endpoints: getPosts, getLikes, getRepostedBy, getQuotes, getActorLikes
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { handleError } from '../utils/error-handler';
import { maybeAvatar } from '../utils/serializers';
import { getAuthenticatedDid, requireAuthDid } from '../utils/auth-helpers';
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

    if (likes.length === 0) {
      return res.json({
        uri: params.uri,
        cid: params.cid,
        cursor,
        likes: [],
      });
    }

    const userDids = likes.map((like) => like.userDid);

    // Batch fetch all required data
    const [
      users,
      relationships,
      listMutes,
      listBlocks,
      allLabels,
      listCounts,
      feedgenCounts,
      starterPackCounts,
      labelerStatuses,
    ] = await Promise.all([
      storage.getUsers(userDids),
      viewerDid
        ? storage.getRelationships(viewerDid, userDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? storage.getListMutesForUsers(viewerDid, userDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? storage.getListBlocksForUsers(viewerDid, userDids)
        : Promise.resolve(new Map()),
      storage.getLabelsForSubjects(userDids),
      storage.getUsersListCounts(userDids),
      storage.getUsersFeedGeneratorCounts(userDids),
      Promise.all(
        userDids.map(async (did) => {
          const packs = await storage.getStarterPacksByCreator(did);
          return { did, count: packs.starterPacks.length };
        })
      ),
      Promise.all(
        userDids.map(async (did) => {
          const labelers = await storage.getLabelerServicesByCreator(did);
          return { did, isLabeler: labelers.length > 0 };
        })
      ),
    ]);

    const userMap = new Map(users.map((u) => [u.did, u]));
    const starterPackCountMap = new Map(
      starterPackCounts.map((sp) => [sp.did, sp.count])
    );
    const labelerStatusMap = new Map(
      labelerStatuses.map((ls) => [ls.did, ls.isLabeler])
    );

    // Fetch list data for mutes/blocks
    const listUris = new Set<string>();
    listMutes.forEach((mute) => listUris.add(mute.listUri));
    listBlocks.forEach((block) => listUris.add(block.listUri));

    const listData = new Map<string, any>();
    if (listUris.size > 0) {
      const lists = await Promise.all(
        Array.from(listUris).map((uri) => storage.getList(uri))
      );
      lists.forEach((list, index) => {
        if (list) {
          listData.set(Array.from(listUris)[index], list);
        }
      });
    }

    // Group labels by subject
    const labelsBySubject = new Map<string, any[]>();
    allLabels.forEach((label) => {
      if (!labelsBySubject.has(label.subject)) {
        labelsBySubject.set(label.subject, []);
      }
      labelsBySubject.get(label.subject)!.push(label);
    });

    res.json({
      uri: params.uri,
      cid: params.cid,
      cursor,
      likes: likes
        .map((like) => {
          const user = userMap.get(like.userDid);
          if (!user) return null;

          const viewerState = viewerDid
            ? relationships.get(like.userDid)
            : null;
          const mutingList = viewerDid ? listMutes.get(like.userDid) : null;
          const blockingList = viewerDid ? listBlocks.get(like.userDid) : null;

          // Build viewer state
          const viewer: any = {};
          if (viewerDid) {
            viewer.muted = !!viewerState?.muting || !!mutingList;
            if (mutingList) {
              const list = listData.get(mutingList.listUri);
              if (list) {
                viewer.mutedByList = {
                  $type: 'app.bsky.graph.defs#listViewBasic',
                  uri: list.uri,
                  name: list.name,
                  purpose: list.purpose,
                };
              }
            }
            viewer.blockedBy = viewerState?.blockedBy || false;
            if (blockingList) {
              const list = listData.get(blockingList.listUri);
              if (list) {
                viewer.blocking = blockingList.uri;
                viewer.blockingByList = {
                  $type: 'app.bsky.graph.defs#listViewBasic',
                  uri: list.uri,
                  name: list.name,
                  purpose: list.purpose,
                };
              }
            } else if (viewerState?.blocking) {
              viewer.blocking = viewerState.blocking;
            }
            if (viewerState?.following)
              viewer.following = viewerState.following;
            if (viewerState?.followedBy)
              viewer.followedBy = viewerState.followedBy;
          }

          // Build full profileView
          const profileView: any = {
            $type: 'app.bsky.actor.defs#profileView',
            did: user.did,
            handle: user.handle,
            displayName: user.displayName || user.handle,
          };

          // Add optional fields
          if (user.description) {
            profileView.description = user.description;
          }

          const avatar = maybeAvatar(user.avatarUrl, user.did, req);
          if (avatar.avatar) {
            profileView.avatar = avatar.avatar;
          }

          // Add associated counts
          profileView.associated = {
            $type: 'app.bsky.actor.defs#profileAssociated',
            lists: listCounts.get(like.userDid) || 0,
            feedgens: feedgenCounts.get(like.userDid) || 0,
            starterPacks: starterPackCountMap.get(like.userDid) || 0,
            labeler: labelerStatusMap.get(like.userDid) || false,
          };

          // Add indexedAt
          if (user.indexedAt) {
            profileView.indexedAt = user.indexedAt.toISOString();
          }

          // Add createdAt
          if (user.createdAt) {
            profileView.createdAt = user.createdAt.toISOString();
          }

          // Add viewer state
          if (Object.keys(viewer).length > 0) {
            profileView.viewer = viewer;
          }

          // Add labels
          const labels = labelsBySubject.get(like.userDid) || [];
          if (labels.length > 0) {
            profileView.labels = labels.map((l: any) => ({
              src: l.src,
              uri: l.uri,
              val: l.val,
              neg: l.neg,
              cts: l.createdAt.toISOString(),
            }));
          }

          return {
            indexedAt: like.indexedAt.toISOString(),
            createdAt: like.createdAt.toISOString(),
            actor: profileView,
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

    if (reposts.length === 0) {
      return res.json({
        uri: params.uri,
        cid: params.cid,
        cursor,
        repostedBy: [],
      });
    }

    const userDids = reposts.map((repost) => repost.userDid);

    // Batch fetch all required data
    const [
      users,
      relationships,
      listMutes,
      listBlocks,
      allLabels,
      listCounts,
      feedgenCounts,
      starterPackCounts,
      labelerStatuses,
    ] = await Promise.all([
      storage.getUsers(userDids),
      viewerDid
        ? storage.getRelationships(viewerDid, userDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? storage.getListMutesForUsers(viewerDid, userDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? storage.getListBlocksForUsers(viewerDid, userDids)
        : Promise.resolve(new Map()),
      storage.getLabelsForSubjects(userDids),
      storage.getUsersListCounts(userDids),
      storage.getUsersFeedGeneratorCounts(userDids),
      Promise.all(
        userDids.map(async (did) => {
          const packs = await storage.getStarterPacksByCreator(did);
          return { did, count: packs.starterPacks.length };
        })
      ),
      Promise.all(
        userDids.map(async (did) => {
          const labelers = await storage.getLabelerServicesByCreator(did);
          return { did, isLabeler: labelers.length > 0 };
        })
      ),
    ]);

    const userMap = new Map(users.map((u) => [u.did, u]));
    const starterPackCountMap = new Map(
      starterPackCounts.map((sp) => [sp.did, sp.count])
    );
    const labelerStatusMap = new Map(
      labelerStatuses.map((ls) => [ls.did, ls.isLabeler])
    );

    // Fetch list data for mutes/blocks
    const listUris = new Set<string>();
    listMutes.forEach((mute) => listUris.add(mute.listUri));
    listBlocks.forEach((block) => listUris.add(block.listUri));

    const listData = new Map<string, any>();
    if (listUris.size > 0) {
      const lists = await Promise.all(
        Array.from(listUris).map((uri) => storage.getList(uri))
      );
      lists.forEach((list, index) => {
        if (list) {
          listData.set(Array.from(listUris)[index], list);
        }
      });
    }

    // Group labels by subject
    const labelsBySubject = new Map<string, any[]>();
    allLabels.forEach((label) => {
      if (!labelsBySubject.has(label.subject)) {
        labelsBySubject.set(label.subject, []);
      }
      labelsBySubject.get(label.subject)!.push(label);
    });

    res.json({
      uri: params.uri,
      cid: params.cid,
      cursor,
      repostedBy: reposts
        .map((repost) => {
          const user = userMap.get(repost.userDid);
          if (!user) return null;

          const viewerState = viewerDid
            ? relationships.get(repost.userDid)
            : null;
          const mutingList = viewerDid ? listMutes.get(repost.userDid) : null;
          const blockingList = viewerDid
            ? listBlocks.get(repost.userDid)
            : null;

          // Build viewer state
          const viewer: any = {};
          if (viewerDid) {
            viewer.muted = !!viewerState?.muting || !!mutingList;
            if (mutingList) {
              const list = listData.get(mutingList.listUri);
              if (list) {
                viewer.mutedByList = {
                  $type: 'app.bsky.graph.defs#listViewBasic',
                  uri: list.uri,
                  name: list.name,
                  purpose: list.purpose,
                };
              }
            }
            viewer.blockedBy = viewerState?.blockedBy || false;
            if (blockingList) {
              const list = listData.get(blockingList.listUri);
              if (list) {
                viewer.blocking = blockingList.uri;
                viewer.blockingByList = {
                  $type: 'app.bsky.graph.defs#listViewBasic',
                  uri: list.uri,
                  name: list.name,
                  purpose: list.purpose,
                };
              }
            } else if (viewerState?.blocking) {
              viewer.blocking = viewerState.blocking;
            }
            if (viewerState?.following)
              viewer.following = viewerState.following;
            if (viewerState?.followedBy)
              viewer.followedBy = viewerState.followedBy;
          }

          // Build full profileView
          const profileView: any = {
            $type: 'app.bsky.actor.defs#profileView',
            did: user.did,
            handle: user.handle,
            displayName: user.displayName || user.handle,
          };

          // Add optional fields
          if (user.description) {
            profileView.description = user.description;
          }

          const avatar = maybeAvatar(user.avatarUrl, user.did, req);
          if (avatar.avatar) {
            profileView.avatar = avatar.avatar;
          }

          // Add associated counts
          profileView.associated = {
            $type: 'app.bsky.actor.defs#profileAssociated',
            lists: listCounts.get(repost.userDid) || 0,
            feedgens: feedgenCounts.get(repost.userDid) || 0,
            starterPacks: starterPackCountMap.get(repost.userDid) || 0,
            labeler: labelerStatusMap.get(repost.userDid) || false,
          };

          // Add indexedAt (profile indexed time, not repost time)
          if (user.indexedAt) {
            profileView.indexedAt = user.indexedAt.toISOString();
          }

          // Add createdAt
          if (user.createdAt) {
            profileView.createdAt = user.createdAt.toISOString();
          }

          // Add viewer state
          if (Object.keys(viewer).length > 0) {
            profileView.viewer = viewer;
          }

          // Add labels
          const labels = labelsBySubject.get(repost.userDid) || [];
          if (labels.length > 0) {
            profileView.labels = labels.map((l: any) => ({
              src: l.src,
              uri: l.uri,
              val: l.val,
              neg: l.neg,
              cts: l.createdAt.toISOString(),
            }));
          }

          return profileView;
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
 *
 * IMPORTANT: ATProto spec requires authentication and actor must be the requesting account
 */
export async function getActorLikes(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getActorLikesSchema.parse(req.query);

    // Require authentication (per ATProto spec)
    const viewerDid = await requireAuthDid(req, res);
    if (!viewerDid) return;

    // Resolve actor to DID
    let actorDid = params.actor;
    if (!params.actor.startsWith('did:')) {
      const user = await storage.getUserByHandle(params.actor);
      if (!user) {
        return res.status(404).json({ error: 'Actor not found' });
      }
      actorDid = user.did;
    }

    // Check for block relationships
    const relationship = await storage.getRelationship(viewerDid, actorDid);
    if (relationship) {
      if (relationship.blocking) {
        return res.status(400).json({
          error: 'BlockedActor',
          message: 'Requesting user has blocked the target actor',
        });
      }
      if (relationship.blockedBy) {
        return res.status(400).json({
          error: 'BlockedByActor',
          message: 'Target actor has blocked the requesting user',
        });
      }
    }

    // Authorization check: actor must be the requesting account
    if (actorDid !== viewerDid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Actor must be the requesting account',
      });
    }

    console.log(
      `[getActorLikes] Fetching likes for ${actorDid}, cursor: ${params.cursor}, limit: ${params.limit}`
    );

    const { likes, cursor } = await storage.getActorLikes(
      actorDid,
      params.limit,
      params.cursor
    );

    console.log(
      `[getActorLikes] Found ${likes.length} likes, next cursor: ${cursor}`
    );

    const postUris = likes.map((like) => like.postUri);
    const posts = await storage.getPosts(postUris);

    // Log if there's a mismatch between liked posts and fetched posts (for debugging)
    if (posts.length !== postUris.length) {
      const foundUris = new Set(posts.map((p) => p.uri));
      const missingUris = postUris.filter((uri) => !foundUris.has(uri));
      console.log(
        `[getActorLikes] ${missingUris.length} liked posts not in database (will be backfilled on login)`
      );
    }

    // Create map to preserve order from likes and match timestamps
    const postMap = new Map(posts.map((p) => [p.uri, p]));

    // Build array of {post, like} pairs, filtering out missing posts
    const postsWithLikes = likes
      .map((like) => {
        const post = postMap.get(like.postUri);
        return post ? { post, like } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const serialized = await (xrpcApi as any).serializePosts(
      postsWithLikes.map(({ post }) => post),
      viewerDid,
      req
    );

    // Build feed response with like timestamps matched correctly
    const feed = serialized.map((post: any, index: number) => ({
      post,
      cursor: postsWithLikes[index]?.like.createdAt.toISOString(),
    }));

    res.json({
      feed,
      cursor: cursor,
    });
  } catch (error) {
    handleError(res, error, 'getActorLikes');
  }
}
