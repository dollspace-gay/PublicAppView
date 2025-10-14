import { db } from '../../db';
import {
  posts,
  users,
  postAggregations,
  postViewerStates,
  likes,
  reposts,
  bookmarks,
  threadGates,
  postGates,
  listMembers,
  listMutes,
  feedGenerators
} from '../../../shared/schema';
import { eq, inArray, sql, and } from 'drizzle-orm';
import { ViewerContextBuilder, ViewerContext } from './viewer-context';
import { EmbedResolver } from './embed-resolver';
import { LabelPropagator, Label } from './label-propagator';
import { HydrationCache } from './cache';
import { constellationIntegration } from '../constellation-integration';
import Redis from 'ioredis';

export interface OptimizedHydrationState {
  posts: Map<string, any>;
  actors: Map<string, any>;
  aggregations: Map<string, any>;
  viewerStates: Map<string, any>;
  actorViewerStates: Map<string, any>;
  embeds: Map<string, any>;
  labels: Map<string, Label[]>;
  threadGates: Map<string, any>;
  postGates: Map<string, any>;
  feedGenerators: Map<string, any>;
  viewerContext?: ViewerContext;
  stats: {
    cacheHits: number;
    cacheMisses: number;
    queryTime: number;
    totalTime: number;
  };
}

interface BatchedQueries {
  posts: Map<string, any>;
  actors: Map<string, any>;
  aggregations: Map<string, any>;
  viewerStates: Map<string, any>;
  threadGates: Map<string, any>;
  postGates: Map<string, any>;
  actorViewerStates?: Map<string, any>;
}

export class OptimizedHydrator {
  private viewerBuilder = new ViewerContextBuilder();
  private embedResolver = new EmbedResolver();
  private labelPropagator = new LabelPropagator();
  private cache = new HydrationCache();
  private redis: Redis | null = null;
  private requestCache = new Map<string, any>(); // Per-request memoization

  constructor() {
    // Initialize Redis if available
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL);
    }
  }

  /**
   * Hydrate posts with optimized batching and caching
   */
  async hydratePosts(
    postUris: string[],
    viewerDid?: string
  ): Promise<OptimizedHydrationState> {
    const startTime = performance.now();
    const stats = {
      cacheHits: 0,
      cacheMisses: 0,
      queryTime: 0,
      totalTime: 0
    };

    if (postUris.length === 0) {
      return this.emptyState();
    }

    // Check cache first
    const { cached, uncached } = await this.checkCache(postUris, viewerDid);
    stats.cacheHits = cached.size;
    stats.cacheMisses = uncached.length;

    if (uncached.length === 0) {
      // All posts were cached
      stats.totalTime = performance.now() - startTime;
      return this.mergeStates(Array.from(cached.values()), stats);
    }

    // Build viewer context once (cached internally)
    const viewerContext = viewerDid 
      ? await this.viewerBuilder.build(viewerDid)
      : undefined;

    // Execute batched queries in parallel
    const queryStart = performance.now();
    const batchedData = await this.executeBatchedQueries(uncached, viewerDid, viewerContext);
    stats.queryTime = performance.now() - queryStart;

    // Process and cache results
    const state = await this.processBatchedResults(batchedData, viewerContext, viewerDid);

    // Cache the results
    if (this.redis) {
      await this.cacheResults(state, viewerDid);
    }

    // Merge cached and fresh data
    const mergedState = this.mergeStates([...Array.from(cached.values()), state], stats);
    
    stats.totalTime = performance.now() - startTime;
    mergedState.stats = stats;

    return mergedState;
  }

  /**
   * Execute all queries in parallel batches
   */
  private async executeBatchedQueries(
    postUris: string[],
    viewerDid?: string,
    viewerContext?: ViewerContext
  ): Promise<BatchedQueries> {
    // Collect all URIs we need to fetch
    const allPostUris = new Set(postUris);
    const actorDids = new Set<string>();
    
    // First pass: get initial posts to find dependencies
    const initialPosts = await db
      .select()
      .from(posts)
      .where(inArray(posts.uri, postUris));

    // Collect all related URIs
    for (const post of initialPosts) {
      actorDids.add(post.authorDid);
      if (post.parentUri) allPostUris.add(post.parentUri);
      if (post.rootUri) allPostUris.add(post.rootUri);
    }

    // Execute all queries in parallel
    const baseQueries = [
      // All posts (including reply parents/roots)
      db.select()
        .from(posts)
        .where(inArray(posts.uri, Array.from(allPostUris))),
      
      // All actors
      db.select()
        .from(users)
        .where(inArray(users.did, Array.from(actorDids))),
      
      // Aggregations with Constellation enrichment
      this.fetchEnrichedAggregations(Array.from(allPostUris)),
      
      // Post viewer states (if viewer)
      viewerDid ? db.select()
        .from(postViewerStates)
        .where(and(
          inArray(postViewerStates.postUri, Array.from(allPostUris)),
          eq(postViewerStates.viewerDid, viewerDid)
        )) : Promise.resolve([]),
      
      // Thread gates
      db.select()
        .from(threadGates)
        .where(inArray(threadGates.postUri, Array.from(allPostUris))),
      
      // Post gates
      db.select()
        .from(postGates)
        .where(inArray(postGates.postUri, Array.from(allPostUris)))
    ];

    // Add viewer-specific queries if authenticated
    const viewerQueries = viewerDid ? [
      this.fetchViewerPostStates(Array.from(allPostUris), viewerDid),
      this.fetchViewerActorStates(Array.from(actorDids), viewerDid)
    ] : [];

    const allResults = await Promise.all([...baseQueries, ...viewerQueries]);

    // Destructure base results
    const [
      allPostsData,
      actorsData,
      aggregationsData,
      viewerStatesData,
      threadGatesData,
      postGatesData
    ] = allResults;

    // Extract viewer-specific results if present
    const viewerPostStates = viewerDid ? allResults[6] : undefined;
    const viewerActorStates = viewerDid ? allResults[7] : undefined;

    // Convert to maps
    const result: BatchedQueries = {
      posts: new Map(),
      actors: new Map(),
      aggregations: new Map(),
      viewerStates: new Map(),
      threadGates: new Map(),
      postGates: new Map()
    };

    // Process posts
    for (const post of allPostsData) {
      result.posts.set(post.uri, {
        uri: post.uri,
        cid: post.cid,
        authorDid: post.authorDid,
        text: post.text,
        createdAt: post.createdAt.toISOString(),
        indexedAt: post.indexedAt.toISOString(),
        embed: post.embed,
        facets: post.facets,
        reply: post.parentUri ? {
          parent: { uri: post.parentUri },
          root: { uri: post.rootUri || post.parentUri }
        } : undefined,
        tags: post.tags,
        violatesThreadGate: post.violatesThreadGate,
        violatesEmbeddingRules: post.violatesEmbeddingRules
      });
    }

    // Process actors
    for (const actor of actorsData) {
      result.actors.set(actor.did, {
        did: actor.did,
        handle: actor.handle,
        displayName: actor.displayName,
        description: actor.description,
        avatarUrl: actor.avatarUrl,
        bannerUrl: actor.bannerUrl,
        pinnedPost: actor.pinnedPost,
        indexedAt: actor.indexedAt?.toISOString()
      });
    }

    // Process aggregations (already enriched)
    result.aggregations = aggregationsData;

    // Process viewer states
    for (const state of viewerStatesData) {
      result.viewerStates.set(state.postUri, {
        likeUri: state.likeUri,
        repostUri: state.repostUri,
        bookmarked: state.bookmarked,
        threadMuted: state.threadMuted,
        replyDisabled: state.replyDisabled,
        embeddingDisabled: state.embeddingDisabled,
        pinned: state.pinned
      });
    }

    // Merge additional viewer post states if available
    if (viewerPostStates) {
      for (const [postUri, state] of viewerPostStates) {
        const existing = result.viewerStates.get(postUri) || {};
        result.viewerStates.set(postUri, { ...existing, ...state });
      }
    }

    // Process thread gates
    for (const gate of threadGatesData) {
      result.threadGates.set(gate.postUri, {
        postUri: gate.postUri,
        ownerDid: gate.ownerDid,
        allowMentions: gate.allowMentions,
        allowFollowing: gate.allowFollowing,
        allowListMembers: gate.allowListMembers,
        allowListUris: gate.allowListUris
      });
    }

    // Process post gates
    for (const gate of postGatesData) {
      result.postGates.set(gate.postUri, {
        postUri: gate.postUri,
        createdAt: gate.createdAt.toISOString(),
        embeddingRules: gate.embeddingRules
      });
    }

    // Store viewer actor states if available
    if (viewerActorStates) {
      result.actorViewerStates = viewerActorStates;
    }

    return result;
  }

  /**
   * Fetch enriched aggregations with Constellation data
   */
  private async fetchEnrichedAggregations(postUris: string[]): Promise<Map<string, any>> {
    const aggregationsData = await db
      .select()
      .from(postAggregations)
      .where(inArray(postAggregations.postUri, postUris));

    const aggregationsMap = new Map<string, any>();
    for (const agg of aggregationsData) {
      aggregationsMap.set(agg.postUri, {
        likeCount: agg.likeCount,
        repostCount: agg.repostCount,
        replyCount: agg.replyCount,
        quoteCount: agg.quoteCount,
        bookmarkCount: agg.bookmarkCount
      });
    }

    // Enrich with Constellation stats if enabled
    if (constellationIntegration.isEnabled()) {
      try {
        await constellationIntegration.enrichAggregations(aggregationsMap, postUris);
      } catch (error) {
        console.error('[OPTIMIZED_HYDRATION] Error enriching with Constellation stats:', error);
      }
    }

    return aggregationsMap;
  }

  /**
   * Fetch viewer-specific post states (likes, reposts, bookmarks)
   */
  private async fetchViewerPostStates(postUris: string[], viewerDid: string): Promise<Map<string, any>> {
    const [likesData, repostsData, bookmarksData] = await Promise.all([
      db.select({ postUri: likes.postUri, uri: likes.uri })
        .from(likes)
        .where(and(
          eq(likes.userDid, viewerDid),
          inArray(likes.postUri, postUris)
        )),
      
      db.select({ postUri: reposts.postUri, uri: reposts.uri })
        .from(reposts)
        .where(and(
          eq(reposts.userDid, viewerDid),
          inArray(reposts.postUri, postUris)
        )),
      
      db.select({ postUri: bookmarks.postUri })
        .from(bookmarks)
        .where(and(
          eq(bookmarks.userDid, viewerDid),
          inArray(bookmarks.postUri, postUris)
        ))
    ]);

    const result = new Map();
    
    // Initialize all posts with empty state
    for (const uri of postUris) {
      result.set(uri, {});
    }

    // Add like data
    for (const like of likesData) {
      const state = result.get(like.postUri) || {};
      state.likeUri = like.uri;
      result.set(like.postUri, state);
    }

    // Add repost data
    for (const repost of repostsData) {
      const state = result.get(repost.postUri) || {};
      state.repostUri = repost.uri;
      result.set(repost.postUri, state);
    }

    // Add bookmark data
    for (const bookmark of bookmarksData) {
      const state = result.get(bookmark.postUri) || {};
      state.bookmarked = true;
      result.set(bookmark.postUri, state);
    }

    return result;
  }

  /**
   * Fetch viewer-specific actor states
   */
  private async fetchViewerActorStates(actorDids: string[], viewerDid: string): Promise<Map<string, any>> {
    // This is already implemented in ViewerContextBuilder
    return await this.viewerBuilder.buildActorStates(viewerDid, actorDids);
  }

  /**
   * Process batched results into final state
   */
  private async processBatchedResults(
    batchedData: BatchedQueries,
    viewerContext?: ViewerContext,
    viewerDid?: string
  ): Promise<OptimizedHydrationState> {
    const postUris = Array.from(batchedData.posts.keys());
    const actorDids = Array.from(batchedData.actors.keys());

    // Resolve embeds in parallel
    const embedsMap = await this.embedResolver.resolveEmbeds(postUris);

    // Fetch labels
    const labelsMap = await this.labelPropagator.propagateActorLabels(actorDids, postUris);

    // Fetch feed generators if any posts are from feed generators
    const feedGeneratorDids = new Set<string>();
    for (const [uri, post] of batchedData.posts) {
      // Check if post has feed generator metadata in tags
      if (post.tags && Array.isArray(post.tags)) {
        for (const tag of post.tags) {
          if (tag.feedGeneratorDid) {
            feedGeneratorDids.add(tag.feedGeneratorDid);
          }
        }
      }
    }

    const feedGeneratorsMap = new Map<string, any>();
    if (feedGeneratorDids.size > 0) {
      const feedGens = await db
        .select()
        .from(feedGenerators)
        .where(inArray(feedGenerators.did, Array.from(feedGeneratorDids)));
      
      for (const gen of feedGens) {
        feedGeneratorsMap.set(gen.did, {
          did: gen.did,
          uri: gen.uri,
          displayName: gen.displayName,
          description: gen.description,
          avatarUrl: gen.avatarUrl,
          createdAt: gen.createdAt.toISOString()
        });
      }
    }

    return {
      posts: batchedData.posts,
      actors: batchedData.actors,
      aggregations: batchedData.aggregations,
      viewerStates: batchedData.viewerStates,
      actorViewerStates: batchedData.actorViewerStates || new Map(),
      embeds: embedsMap,
      labels: labelsMap,
      threadGates: batchedData.threadGates,
      postGates: batchedData.postGates,
      feedGenerators: feedGeneratorsMap,
      viewerContext,
      stats: {
        cacheHits: 0,
        cacheMisses: 0,
        queryTime: 0,
        totalTime: 0
      }
    };
  }

  /**
   * Check cache for already hydrated posts
   */
  private async checkCache(
    postUris: string[],
    viewerDid?: string
  ): Promise<{ cached: Map<string, OptimizedHydrationState>, uncached: string[] }> {
    if (!this.redis) {
      return { cached: new Map(), uncached: postUris };
    }

    const cached = new Map<string, OptimizedHydrationState>();
    const uncached: string[] = [];

    // Build cache keys
    const cacheKeys = postUris.map(uri => this.buildCacheKey(uri, viewerDid));
    
    // Batch get from Redis
    try {
      const results = await this.redis.mget(...cacheKeys);
      
      for (let i = 0; i < postUris.length; i++) {
        if (results[i]) {
          const state = JSON.parse(results[i] as string);
          // Convert plain objects back to Maps
          cached.set(postUris[i], this.deserializeState(state));
        } else {
          uncached.push(postUris[i]);
        }
      }
    } catch (error) {
      console.error('[OPTIMIZED_HYDRATION] Cache read error:', error);
      return { cached: new Map(), uncached: postUris };
    }

    return { cached, uncached };
  }

  /**
   * Cache hydration results
   */
  private async cacheResults(state: OptimizedHydrationState, viewerDid?: string): Promise<void> {
    if (!this.redis) return;

    try {
      const pipeline = this.redis.pipeline();
      
      // Cache each post individually for granular retrieval
      for (const [uri, post] of state.posts) {
        const key = this.buildCacheKey(uri, viewerDid);
        const postState: OptimizedHydrationState = {
          posts: new Map([[uri, post]]),
          actors: new Map(),
          aggregations: new Map(),
          viewerStates: new Map(),
          actorViewerStates: new Map(),
          embeds: new Map(),
          labels: new Map(),
          threadGates: new Map(),
          postGates: new Map(),
          feedGenerators: new Map(),
          viewerContext: state.viewerContext,
          stats: state.stats
        };

        // Add related data
        if (post.authorDid && state.actors.has(post.authorDid)) {
          postState.actors.set(post.authorDid, state.actors.get(post.authorDid));
        }
        if (state.aggregations.has(uri)) {
          postState.aggregations.set(uri, state.aggregations.get(uri));
        }
        if (state.viewerStates.has(uri)) {
          postState.viewerStates.set(uri, state.viewerStates.get(uri));
        }
        if (state.embeds.has(uri)) {
          postState.embeds.set(uri, state.embeds.get(uri));
        }
        if (state.labels.has(uri)) {
          postState.labels.set(uri, state.labels.get(uri));
        }
        if (state.threadGates.has(uri)) {
          postState.threadGates.set(uri, state.threadGates.get(uri));
        }
        if (state.postGates.has(uri)) {
          postState.postGates.set(uri, state.postGates.get(uri));
        }

        // Serialize and cache with TTL
        const serialized = this.serializeState(postState);
        pipeline.setex(key, 300, JSON.stringify(serialized)); // 5 minute TTL
      }

      await pipeline.exec();
    } catch (error) {
      console.error('[OPTIMIZED_HYDRATION] Cache write error:', error);
    }
  }

  /**
   * Build cache key
   */
  private buildCacheKey(postUri: string, viewerDid?: string): string {
    return viewerDid 
      ? `hydration:post:${postUri}:viewer:${viewerDid}`
      : `hydration:post:${postUri}:public`;
  }

  /**
   * Serialize state for caching (convert Maps to objects)
   */
  private serializeState(state: OptimizedHydrationState): any {
    return {
      ...state,
      posts: Object.fromEntries(state.posts),
      actors: Object.fromEntries(state.actors),
      aggregations: Object.fromEntries(state.aggregations),
      viewerStates: Object.fromEntries(state.viewerStates),
      actorViewerStates: Object.fromEntries(state.actorViewerStates),
      embeds: Object.fromEntries(state.embeds),
      labels: Object.fromEntries(state.labels),
      threadGates: Object.fromEntries(state.threadGates),
      postGates: Object.fromEntries(state.postGates),
      feedGenerators: Object.fromEntries(state.feedGenerators)
    };
  }

  /**
   * Deserialize state from cache (convert objects to Maps)
   */
  private deserializeState(data: any): OptimizedHydrationState {
    return {
      ...data,
      posts: new Map(Object.entries(data.posts || {})),
      actors: new Map(Object.entries(data.actors || {})),
      aggregations: new Map(Object.entries(data.aggregations || {})),
      viewerStates: new Map(Object.entries(data.viewerStates || {})),
      actorViewerStates: new Map(Object.entries(data.actorViewerStates || {})),
      embeds: new Map(Object.entries(data.embeds || {})),
      labels: new Map(Object.entries(data.labels || {})),
      threadGates: new Map(Object.entries(data.threadGates || {})),
      postGates: new Map(Object.entries(data.postGates || {})),
      feedGenerators: new Map(Object.entries(data.feedGenerators || {}))
    };
  }

  /**
   * Merge multiple hydration states
   */
  private mergeStates(states: OptimizedHydrationState[], stats: any): OptimizedHydrationState {
    const merged: OptimizedHydrationState = {
      posts: new Map(),
      actors: new Map(),
      aggregations: new Map(),
      viewerStates: new Map(),
      actorViewerStates: new Map(),
      embeds: new Map(),
      labels: new Map(),
      threadGates: new Map(),
      postGates: new Map(),
      feedGenerators: new Map(),
      viewerContext: states[0]?.viewerContext,
      stats
    };

    for (const state of states) {
      // Merge all maps
      for (const [k, v] of state.posts) merged.posts.set(k, v);
      for (const [k, v] of state.actors) merged.actors.set(k, v);
      for (const [k, v] of state.aggregations) merged.aggregations.set(k, v);
      for (const [k, v] of state.viewerStates) merged.viewerStates.set(k, v);
      for (const [k, v] of state.actorViewerStates) merged.actorViewerStates.set(k, v);
      for (const [k, v] of state.embeds) merged.embeds.set(k, v);
      for (const [k, v] of state.labels) merged.labels.set(k, v);
      for (const [k, v] of state.threadGates) merged.threadGates.set(k, v);
      for (const [k, v] of state.postGates) merged.postGates.set(k, v);
      for (const [k, v] of state.feedGenerators) merged.feedGenerators.set(k, v);
    }

    return merged;
  }

  /**
   * Clear all caches
   */
  async clearCache() {
    this.embedResolver.clearCache();
    this.requestCache.clear();
    
    if (this.redis) {
      try {
        const keys = await this.redis.keys('hydration:*');
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch (error) {
        console.error('[OPTIMIZED_HYDRATION] Cache clear error:', error);
      }
    }
  }

  private emptyState(): OptimizedHydrationState {
    return {
      posts: new Map(),
      actors: new Map(),
      aggregations: new Map(),
      viewerStates: new Map(),
      actorViewerStates: new Map(),
      embeds: new Map(),
      labels: new Map(),
      threadGates: new Map(),
      postGates: new Map(),
      feedGenerators: new Map(),
      stats: {
        cacheHits: 0,
        cacheMisses: 0,
        queryTime: 0,
        totalTime: 0
      }
    };
  }
}

// Export singleton instance
export const optimizedHydrator = new OptimizedHydrator();