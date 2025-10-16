/**
 * Timeline Service
 * Handles timeline feeds, author feeds, post threads, and feed generator consumption
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import { maybeAvatar } from '../utils/serializers';
import {
  getTimelineSchema,
  getAuthorFeedSchema,
  getPostThreadSchema,
  getPostThreadV2Schema,
  getPostThreadOtherV2Schema,
} from '../schemas/timeline-schemas';
import { getFeedSchema } from '../schemas/feed-generator-schemas';
import { contentFilter } from '../../content-filter';
import { feedAlgorithm } from '../../feed-algorithm';
import { feedGeneratorClient } from '../../feed-generator-client';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get authenticated user's timeline
 * GET /xrpc/app.bsky.feed.getTimeline
 */
export async function getTimeline(req: Request, res: Response): Promise<void> {
  try {
    const params = getTimelineSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Debug: Check user's follow count and their posts
    const [followCount, userPostCount] = await Promise.all([
      storage.getUserFollowingCount(userDid),
      storage.getUserPostCount(userDid),
    ]);

    console.log(
      `[TIMELINE_DEBUG] User ${userDid} is following ${followCount} accounts, has ${userPostCount} posts`
    );

    let posts = await storage.getTimeline(userDid, params.limit, params.cursor);

    console.log(
      `[TIMELINE_DEBUG] Retrieved ${posts.length} posts for timeline`
    );

    const settings = await storage.getUserSettings(userDid);
    if (settings) {
      posts = contentFilter.filterPosts(posts, settings);
    }

    let algorithmParam = params.algorithm;
    if (!algorithmParam && settings?.feedPreferences) {
      const prefs = settings.feedPreferences as { algorithm?: string };
      algorithmParam = prefs.algorithm;
    }
    const algorithm = feedAlgorithm.parseAlgorithm(algorithmParam);
    const rankedPosts = await feedAlgorithm.applyAlgorithm(posts, algorithm);

    const oldestPost =
      posts.length > 0
        ? posts.reduce((oldest, post) =>
            post.indexedAt < oldest.indexedAt ? post : oldest
          )
        : null;

    // Use legacy API for complex post serialization
    // TODO: Extract serializePosts to utils in future iteration
    const serializedPosts = await (xrpcApi as any).serializePosts(
      rankedPosts,
      userDid,
      req
    );

    // Filter out any null entries (defensive - shouldn't happen with handle.invalid fallback)
    const validPosts = serializedPosts.filter((post: any) => post !== null);

    // Ensure we always return a valid response structure
    const response = {
      cursor: oldestPost ? oldestPost.indexedAt.toISOString() : undefined,
      feed: validPosts.map((post: any) => ({ post })),
    };

    // Log the response structure for debugging
    console.log(
      `[TIMELINE_DEBUG] Sending response with ${response.feed.length} posts`
    );

    res.json(response);
  } catch (error) {
    handleError(res, error, 'getTimeline');
  }
}

/**
 * Get posts by a specific author
 * GET /xrpc/app.bsky.feed.getAuthorFeed
 */
export async function getAuthorFeed(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getAuthorFeedSchema.parse(req.query);
    const authorDid = await resolveActor(res, params.actor);
    if (!authorDid) return;

    const viewerDid = await getAuthenticatedDid(req);

    // Profile and posts should be available from firehose events
    // Get the author's profile to check for pinned posts
    const author = await storage.getUser(authorDid);
    if (!author) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    // Check for blocking relationships
    if (viewerDid) {
      const blocks = await storage.getBlocksBetweenUsers(viewerDid, [
        authorDid,
      ]);
      if (blocks.length > 0) {
        res.status(400).json({
          error: `Requester has blocked actor: ${authorDid}`,
          name: 'BlockedActor',
        });
        return;
      }

      const blockedBy = await storage.getBlocksBetweenUsers(authorDid, [
        viewerDid,
      ]);
      if (blockedBy.length > 0) {
        res.status(400).json({
          error: `Requester is blocked by actor: ${authorDid}`,
          name: 'BlockedByActor',
        });
        return;
      }
    }

    // Get feed items using the new feed system
    const feedResult = await storage.getAuthorFeed(
      authorDid,
      params.limit,
      params.cursor,
      params.filter
    );

    let items = feedResult.items;

    // Handle pinned posts
    if (params.includePins && author.pinnedPost && !params.cursor) {
      const pinnedPost = author.pinnedPost as { uri: string; cid: string };
      const pinnedItem = {
        post: {
          uri: pinnedPost.uri,
          cid: pinnedPost.cid,
        },
        authorPinned: true,
      };

      // Remove any existing pinned post from the feed and add it to the top
      items = items.filter((item) => item.post.uri !== pinnedItem.post.uri);
      items.unshift(pinnedItem);
    }

    // Extract post URIs for hydration
    const postUris = items.map((item) => item.post.uri);

    // Fetch posts from storage for serialization
    const posts = await storage.getPosts(postUris);

    // Fetch reposts and reposter profiles for reason construction
    const repostUris = items
      .filter((item) => item.repost)
      .map((item) => item.repost!.uri);

    const reposts = await Promise.all(
      repostUris.map((uri) => storage.getRepost(uri))
    );
    const repostsByUri = new Map(
      reposts.filter(Boolean).map((r) => [r!.uri, r!])
    );

    // Get all reposter DIDs for profile fetching
    const reposterDids = Array.from(repostsByUri.values()).map(
      (r) => r.userDid
    );
    const reposters = await Promise.all(
      reposterDids.map((did) => storage.getUser(did))
    );
    const repostersByDid = new Map(
      reposters.filter(Boolean).map((u) => [u!.did, u!])
    );

    // Apply content filtering if viewer is authenticated
    let filteredPosts = posts;
    if (viewerDid) {
      const settings = await storage.getUserSettings(viewerDid);
      if (settings) {
        filteredPosts = contentFilter.filterPosts(posts, settings);
      }
    }

    // Serialize posts with enhanced hydration (when flag is enabled)
    const serializedPosts = await (xrpcApi as any).serializePosts(
      filteredPosts,
      viewerDid,
      req
    );
    const postsByUri = new Map(serializedPosts.map((p: any) => [p.uri, p]));

    // Build feed with reposts and pinned posts
    const feed = items
      .map((item) => {
        const post = postsByUri.get(item.post.uri);
        if (!post) return null;

        let reason: any = undefined;

        // Handle pinned post reason
        if (item.authorPinned) {
          reason = {
            $type: 'app.bsky.feed.defs#reasonPin',
          };
        }
        // Handle repost reason
        else if (item.repost) {
          const repost = repostsByUri.get(item.repost.uri);
          const reposter = repost ? repostersByDid.get(repost.userDid) : null;

          if (repost && reposter) {
            reason = {
              $type: 'app.bsky.feed.defs#reasonRepost',
              by: {
                $type: 'app.bsky.actor.defs#profileViewBasic',
                did: reposter.did,
                handle: reposter.handle,
                displayName: reposter.displayName || reposter.handle,
                ...maybeAvatar(reposter.avatarUrl, reposter.did, req),
              },
              indexedAt: repost.indexedAt.toISOString(),
            };
          }
        }

        return {
          post,
          ...(reason && { reason }),
        };
      })
      .filter(Boolean);

    res.json({
      cursor: feedResult.cursor,
      feed,
    });
  } catch (error) {
    handleError(res, error, 'getAuthorFeed');
  }
}

/**
 * Get a post thread
 * GET /xrpc/app.bsky.feed.getPostThread
 */
export async function getPostThread(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getPostThreadSchema.parse(req.query);

    // Trigger thread context backfill in background (non-blocking)
    const { threadContextBackfillService } = await import(
      '../../thread-context-backfill'
    );
    threadContextBackfillService.backfillPostContext(params.uri).catch((err) => {
      console.error('[THREAD_CONTEXT] Error backfilling context:', err);
    });

    const allThreadPosts = await storage.getPostThread(params.uri);

    if (allThreadPosts.length === 0) {
      res.status(404).json({ error: 'Post not found' });
      return;
    }

    const viewerDid = await getAuthenticatedDid(req);

    const rootPost = allThreadPosts[0];
    let replies = allThreadPosts.slice(1);

    if (viewerDid) {
      const settings = await storage.getUserSettings(viewerDid);
      if (settings) {
        replies = contentFilter.filterPosts(replies, settings);
      }
    }

    const postsToSerialize = [rootPost, ...replies];
    const serializedPosts = await (xrpcApi as any).serializePosts(
      postsToSerialize,
      viewerDid || undefined,
      req
    );
    const serializedPostsByUri = new Map(
      serializedPosts.map((p: any) => [p.uri, p])
    );

    const threadPost = serializedPostsByUri.get(rootPost.uri);
    if (!threadPost) {
      res
        .status(500)
        .json({ error: 'Failed to serialize root post of thread' });
      return;
    }

    const threadReplies = replies
      .map((reply) => serializedPostsByUri.get(reply.uri))
      .filter(Boolean) as any[];

    const threadView: any = {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: threadPost,
      replies: threadReplies.map((reply) => ({
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: reply,
      })),
    };

    res.json({
      thread: threadView,
    });
  } catch (error) {
    handleError(res, error, 'getPostThread');
  }
}

/**
 * Get posts from a feed generator
 * GET /xrpc/app.bsky.feed.getFeed
 */
export async function getFeed(req: Request, res: Response): Promise<void> {
  try {
    const params = getFeedSchema.parse(req.query);

    // Get feed generator info
    const feedGen = await storage.getFeedGenerator(params.feed);
    if (!feedGen) {
      res.status(404).json({ error: 'Feed generator not found' });
      return;
    }

    console.log(
      `[XRPC] Getting feed from generator: ${feedGen.displayName} (${feedGen.did})`
    );

    // Call external feed generator service to get skeleton
    // Then hydrate with full post data from our database
    const { feed: hydratedFeed, cursor } = await feedGeneratorClient.getFeed(
      feedGen.did,
      {
        feed: params.feed,
        limit: params.limit,
        cursor: params.cursor,
      },
      {
        viewerAuthorization: req.headers['authorization'] as string | undefined,
      }
    );

    console.log(
      `[XRPC] Hydrated ${hydratedFeed.length} posts from feed generator`
    );

    // Build post views with author information
    const feed = await Promise.all(
      hydratedFeed.map(async ({ post, reason }) => {
        const author = await storage.getUser(post.authorDid);

        // Skip posts from authors without valid handles
        if (!author || !author.handle) {
          console.warn(
            `[XRPC] Skipping post ${post.uri} - author ${post.authorDid} has no handle`
          );
          return null;
        }

        const postView: any = {
          uri: post.uri,
          cid: post.cid,
          author: {
            $type: 'app.bsky.actor.defs#profileViewBasic',
            did: post.authorDid,
            handle: author.handle,
            displayName: author.displayName ?? author.handle,
            pronouns: author?.pronouns,
            ...maybeAvatar(author?.avatarUrl, author?.did, req),
            associated: {
              $type: 'app.bsky.actor.defs#profileAssociated',
              lists: 0,
              feedgens: 0,
              starterPacks: 0,
              labeler: false,
              chat: undefined,
              activitySubscription: undefined,
            },
            viewer: undefined,
            labels: [],
            createdAt: author?.createdAt?.toISOString(),
            verification: undefined,
            status: undefined,
          },
          record: {
            text: post.text,
            createdAt: post.createdAt.toISOString(),
          },
          replyCount: 0,
          repostCount: 0,
          likeCount: 0,
          indexedAt: post.indexedAt.toISOString(),
        };

        const feedView: any = { post: postView };

        // Include reason if present (e.g., repost context)
        if (reason) {
          feedView.reason = reason;
        }

        return feedView;
      })
    );

    // Filter out null entries (posts from authors without handles)
    const validFeed = feed.filter((item) => item !== null);

    res.json({ feed: validFeed, cursor });
  } catch (error) {
    // If feed generator is unavailable, provide a helpful error
    handleError(res, error, 'getFeed');
  }
}

/**
 * Get post thread (V2 - unspecced)
 * GET /xrpc/app.bsky.unspecced.getPostThreadV2
 */
export async function getPostThreadV2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getPostThreadV2Schema.parse(req.query);
    const posts = await storage.getPostThread(params.anchor);
    const viewerDid = await getAuthenticatedDid(req);

    const serialized = await (xrpcApi as any).serializePosts(
      posts,
      viewerDid || undefined,
      req
    );

    res.json({
      hasOtherReplies: false,
      thread: serialized.length
        ? {
            $type: 'app.bsky.unspecced.defs#threadItemPost',
            post: serialized[0],
          }
        : null,
      threadgate: null,
    });
  } catch (error) {
    handleError(res, error, 'getPostThreadV2');
  }
}

/**
 * Get other thread replies (V2 - unspecced stub)
 * GET /xrpc/app.bsky.unspecced.getPostThreadOtherV2
 */
export async function getPostThreadOtherV2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    getPostThreadOtherV2Schema.parse(req.query);
    res.json({ hasOtherReplies: false, items: [] });
  } catch (error) {
    handleError(res, error, 'getPostThreadOtherV2');
  }
}
