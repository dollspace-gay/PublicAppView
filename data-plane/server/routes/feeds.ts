import { Router } from 'express';
import { db } from '../../../server/db';
import { posts, feedItems, postAggregations, users } from '../../../shared/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import type {
  GetAuthorFeedRequest,
  GetTimelineRequest,
  GetPostThreadRequest,
  GetPostRequest,
  GetPostsRequest,
  FeedItemRecord,
  PostRecord,
  ThreadRecord,
  PaginatedResponse,
} from '../types';

const router = Router();

/**
 * Get author's feed (posts and reposts)
 */
router.post('/getAuthorFeed', async (req, res) => {
  try {
    const { actor, filter = 'posts_with_replies', limit = 50, cursor } = req.body as GetAuthorFeedRequest;

    if (!actor) {
      return res.status(400).json({ error: 'actor is required' });
    }

    const actualLimit = Math.min(limit, 100);

    // Resolve actor to DID
    const isDID = actor.startsWith('did:');
    const user = isDID
      ? await db.query.users.findFirst({ where: eq(users.did, actor) })
      : await db.query.users.findFirst({ where: eq(users.handle, actor) });

    if (!user) {
      return res.status(404).json({ error: 'Actor not found' });
    }

    // Build query based on filter
    let items = await db
      .select({
        uri: feedItems.uri,
        postUri: feedItems.postUri,
        originatorDid: feedItems.originatorDid,
        type: feedItems.type,
        sortAt: feedItems.sortAt,
        cid: feedItems.cid,
      })
      .from(feedItems)
      .where(
        and(
          eq(feedItems.originatorDid, user.did),
          cursor ? sql`${feedItems.sortAt} < ${cursor}` : undefined
        )
      )
      .orderBy(desc(feedItems.sortAt))
      .limit(actualLimit + 1);

    const hasMore = items.length > actualLimit;
    const feedItemsList = hasMore ? items.slice(0, actualLimit) : items;

    // Get post data
    const postUris = feedItemsList.map((item) => item.postUri);
    const postsData = await db
      .select()
      .from(posts)
      .innerJoin(postAggregations, eq(posts.uri, postAggregations.postUri))
      .where(inArray(posts.uri, postUris));

    const postsMap = new Map(
      postsData.map((p) => [
        p.posts.uri,
        {
          uri: p.posts.uri,
          cid: p.posts.cid,
          authorDid: p.posts.authorDid,
          text: p.posts.text,
          parentUri: p.posts.parentUri || undefined,
          rootUri: p.posts.rootUri || undefined,
          embed: p.posts.embed,
          facets: p.posts.facets,
          likeCount: p.post_aggregations.likeCount,
          repostCount: p.post_aggregations.repostCount,
          replyCount: p.post_aggregations.replyCount,
          quoteCount: p.post_aggregations.quoteCount,
          indexedAt: p.posts.indexedAt.toISOString(),
          createdAt: p.posts.createdAt.toISOString(),
        } as PostRecord,
      ])
    );

    const feedItemRecords: FeedItemRecord[] = feedItemsList.map((item) => ({
      uri: item.uri,
      postUri: item.postUri,
      originatorDid: item.originatorDid,
      type: item.type as 'post' | 'repost',
      sortAt: item.sortAt.toISOString(),
      post: postsMap.get(item.postUri)!,
      repostUri: item.type === 'repost' ? item.uri : undefined,
    }));

    const response: PaginatedResponse<FeedItemRecord> = {
      items: feedItemRecords,
      cursor: hasMore ? feedItemsList[feedItemsList.length - 1].sortAt.toISOString() : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error('[DATA_PLANE] Error in getAuthorFeed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get timeline (following feed)
 */
router.post('/getTimeline', async (req, res) => {
  try {
    const { actor, limit = 50, cursor } = req.body as GetTimelineRequest;

    if (!actor) {
      return res.status(400).json({ error: 'actor is required' });
    }

    // TODO: Implement timeline logic
    // This requires joining follows with feed_items
    res.status(501).json({ error: 'Not implemented yet' });
  } catch (error) {
    console.error('[DATA_PLANE] Error in getTimeline:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get post thread
 */
router.post('/getPostThread', async (req, res) => {
  try {
    const { uri, depth = 6, parentHeight = 80, viewerDid } = req.body as GetPostThreadRequest;

    if (!uri) {
      return res.status(400).json({ error: 'uri is required' });
    }

    // Use thread assembler to build the full thread tree
    const { threadAssembler } = await import('../services/thread-assembler');

    const thread = await threadAssembler.assembleThread({
      uri,
      depth,
      parentHeight,
      viewerDid,
    });

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    res.json(thread);
  } catch (error) {
    console.error('[DATA_PLANE] Error in getPostThread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get single post
 */
router.post('/getPost', async (req, res) => {
  try {
    const { uri } = req.body as GetPostRequest;

    if (!uri) {
      return res.status(400).json({ error: 'uri is required' });
    }

    const result = await db
      .select()
      .from(posts)
      .innerJoin(postAggregations, eq(posts.uri, postAggregations.postUri))
      .where(eq(posts.uri, uri))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const p = result[0];
    const post: PostRecord = {
      uri: p.posts.uri,
      cid: p.posts.cid,
      authorDid: p.posts.authorDid,
      text: p.posts.text,
      parentUri: p.posts.parentUri || undefined,
      rootUri: p.posts.rootUri || undefined,
      embed: p.posts.embed,
      facets: p.posts.facets,
      likeCount: p.post_aggregations.likeCount,
      repostCount: p.post_aggregations.repostCount,
      replyCount: p.post_aggregations.replyCount,
      quoteCount: p.post_aggregations.quoteCount,
      indexedAt: p.posts.indexedAt.toISOString(),
      createdAt: p.posts.createdAt.toISOString(),
    };

    res.json(post);
  } catch (error) {
    console.error('[DATA_PLANE] Error in getPost:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get multiple posts in batch
 */
router.post('/getPosts', async (req, res) => {
  try {
    const { uris } = req.body as GetPostsRequest;

    if (!uris || !Array.isArray(uris) || uris.length === 0) {
      return res.status(400).json({ error: 'uris array is required' });
    }

    const result = await db
      .select()
      .from(posts)
      .innerJoin(postAggregations, eq(posts.uri, postAggregations.postUri))
      .where(inArray(posts.uri, uris));

    const postRecords: PostRecord[] = result.map((p) => ({
      uri: p.posts.uri,
      cid: p.posts.cid,
      authorDid: p.posts.authorDid,
      text: p.posts.text,
      parentUri: p.posts.parentUri || undefined,
      rootUri: p.posts.rootUri || undefined,
      embed: p.posts.embed,
      facets: p.posts.facets,
      likeCount: p.post_aggregations.likeCount,
      repostCount: p.post_aggregations.repostCount,
      replyCount: p.post_aggregations.replyCount,
      quoteCount: p.post_aggregations.quoteCount,
      indexedAt: p.posts.indexedAt.toISOString(),
      createdAt: p.posts.createdAt.toISOString(),
    }));

    res.json({ posts: postRecords });
  } catch (error) {
    console.error('[DATA_PLANE] Error in getPosts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as feedRoutes };
