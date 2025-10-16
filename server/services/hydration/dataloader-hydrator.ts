import { HydrationDataLoader, createDataLoader } from './dataloader';
import { EmbedResolver } from './embed-resolver';
import { LabelPropagator } from './label-propagator';
import Redis from 'ioredis';

export interface DataLoaderHydrationState {
  posts: Map<string, any>;
  actors: Map<string, any>;
  aggregations: Map<string, any>;
  viewerStates: Map<string, any>;
  actorViewerStates: Map<string, any>;
  embeds: Map<string, any>;
  labels: Map<string, any[]>;
  threadGates: Map<string, any>;
  postGates: Map<string, any>;
  stats: {
    dataLoaderBatches: number;
    cacheHits: number;
    cacheMisses: number;
    queryTime: number;
    totalTime: number;
  };
}

/**
 * Optimized post hydrator using DataLoader pattern for efficient batching
 */
export class DataLoaderHydrator {
  private embedResolver = new EmbedResolver();
  private labelPropagator = new LabelPropagator();
  private redis: Redis | null = null;

  constructor() {
    // Initialize Redis if available
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL);
    }
  }

  /**
   * Hydrate posts with DataLoader batching
   */
  async hydratePosts(
    postUris: string[],
    viewerDid?: string,
    dataLoader?: HydrationDataLoader
  ): Promise<DataLoaderHydrationState> {
    const startTime = performance.now();
    const stats = {
      dataLoaderBatches: 0,
      cacheHits: 0,
      cacheMisses: 0,
      queryTime: 0,
      totalTime: 0,
    };

    if (postUris.length === 0) {
      return this.emptyState(stats);
    }

    // Use provided DataLoader or create a new one for this request
    const loader = dataLoader || createDataLoader();
    const queryStart = performance.now();

    try {
      // Load all posts and their basic data
      const posts = await Promise.all(
        postUris.map((uri) => loader.posts.load(uri))
      );
      stats.dataLoaderBatches++;

      // Filter out null posts
      const validPosts = posts.filter(Boolean);
      if (validPosts.length === 0) {
        stats.queryTime = performance.now() - queryStart;
        stats.totalTime = performance.now() - startTime;
        return this.emptyState(stats);
      }

      // Collect all unique DIDs and URIs we need to load
      const authorDids = new Set<string>();
      const allPostUris = new Set<string>(postUris);
      const parentUris = new Set<string>();
      const rootUris = new Set<string>();

      for (const post of validPosts) {
        authorDids.add(post.authorDid);
        if (post.parentUri) {
          parentUris.add(post.parentUri);
          allPostUris.add(post.parentUri);
        }
        if (post.rootUri && post.rootUri !== post.parentUri) {
          rootUris.add(post.rootUri);
          allPostUris.add(post.rootUri);
        }
      }

      // Load all related data in parallel using DataLoader batching
      const [
        authors,
        aggregations,
        viewerStates,
        actorViewerStates,
        labels,
        threadGates,
        postGates,
        parentPosts,
        rootPosts,
      ] = await Promise.all([
        // Authors
        Promise.all(
          Array.from(authorDids).map((did) => loader.users.load(did))
        ),
        // Aggregations
        Promise.all(validPosts.map((p) => loader.aggregations.load(p.uri))),
        // Viewer states (if viewer is authenticated)
        viewerDid
          ? Promise.all(
              validPosts.map((p) =>
                loader.viewerStates.load(`${p.uri}:${viewerDid}`)
              )
            )
          : [],
        // Actor viewer states
        viewerDid
          ? Promise.all(
              Array.from(authorDids).map((did) =>
                loader.actorViewerStates.load(`${did}:${viewerDid}`)
              )
            )
          : [],
        // Labels
        Promise.all(
          Array.from(allPostUris).map((uri) => loader.labels.load(uri))
        ),
        // Thread gates
        Promise.all(validPosts.map((p) => loader.threadGates.load(p.uri))),
        // Post gates
        Promise.all(validPosts.map((p) => loader.postGates.load(p.uri))),
        // Parent posts
        Promise.all(
          Array.from(parentUris).map((uri) => loader.posts.load(uri))
        ),
        // Root posts
        Promise.all(Array.from(rootUris).map((uri) => loader.posts.load(uri))),
      ]);

      stats.dataLoaderBatches += 8; // Count the parallel batch operations

      // Build result maps
      const postMap = new Map<string, any>();
      const actorMap = new Map<string, any>();
      const aggregationMap = new Map<string, any>();
      const viewerStateMap = new Map<string, any>();
      const actorViewerStateMap = new Map<string, any>();
      const labelMap = new Map<string, any[]>();
      const threadGateMap = new Map<string, any>();
      const postGateMap = new Map<string, any>();

      // Map posts
      validPosts.forEach((post) => postMap.set(post.uri, post));
      parentPosts
        .filter(Boolean)
        .forEach((post) => postMap.set(post.uri, post));
      rootPosts.filter(Boolean).forEach((post) => postMap.set(post.uri, post));

      // Map authors
      Array.from(authorDids).forEach((did, i) => {
        if (authors[i]) actorMap.set(did, authors[i]);
      });

      // Map aggregations
      validPosts.forEach((post, i) => {
        aggregationMap.set(post.uri, aggregations[i]);
      });

      // Map viewer states
      if (viewerDid) {
        validPosts.forEach((post, i) => {
          viewerStateMap.set(post.uri, viewerStates[i]);
        });

        Array.from(authorDids).forEach((did, i) => {
          actorViewerStateMap.set(did, actorViewerStates[i]);
        });
      }

      // Map labels
      Array.from(allPostUris).forEach((uri, i) => {
        labelMap.set(uri, labels[i] || []);
      });

      // Map gates
      validPosts.forEach((post, i) => {
        if (threadGates[i]) threadGateMap.set(post.uri, threadGates[i]);
        if (postGates[i]) postGateMap.set(post.uri, postGates[i]);
      });

      // Resolve embeds
      const embedMap = await this.embedResolver.resolveEmbeds(
        Array.from(postMap.keys()), // Pass URIs, not post objects
        0, // depth
        new Set<string>(), // visited
        loader // dataLoader
      );

      // Propagate labels if needed
      const propagatedLabels = await this.labelPropagator.propagateActorLabels(
        Array.from(authorDids),
        Array.from(allPostUris)
      );

      stats.queryTime = performance.now() - queryStart;
      stats.totalTime = performance.now() - startTime;

      return {
        posts: postMap,
        actors: actorMap,
        aggregations: aggregationMap,
        viewerStates: viewerStateMap,
        actorViewerStates: actorViewerStateMap,
        embeds: embedMap,
        labels: propagatedLabels,
        threadGates: threadGateMap,
        postGates: postGateMap,
        stats,
      };
    } catch (error) {
      console.error('[DATALOADER_HYDRATOR] Error:', error);
      throw error;
    }
  }

  /**
   * Create an empty hydration state
   */
  private emptyState(stats: any): DataLoaderHydrationState {
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
      stats,
    };
  }

  /**
   * Clear all caches
   */
  async clearCache() {
    this.embedResolver.clearCache();
    // Clear Redis cache if available
    if (this.redis) {
      await this.redis.flushdb();
    }
  }
}

// Export singleton instance
export const dataLoaderHydrator = new DataLoaderHydrator();
