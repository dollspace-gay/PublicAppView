import DataLoader from 'dataloader';
import { db } from '../../db';
import {
  posts,
  users,
  postAggregations,
  postViewerStates,
  likes,
  reposts,
  bookmarks,
  blocks,
  mutes,
  follows,
  threadGates,
  postGates,
  labels as labelsTable
} from '../../../shared/schema';
import { eq, inArray, and, or, sql } from 'drizzle-orm';

export interface ViewerStateKey {
  uri: string;
  viewerDid: string;
}

export interface ActorViewerStateKey {
  actorDid: string;
  viewerDid: string;
}

/**
 * DataLoader-based hydration service that batches and caches database queries
 * to eliminate N+1 query problems and improve performance
 */
export class HydrationDataLoader {
  private postLoader: DataLoader<string, any>;
  private userLoader: DataLoader<string, any>;
  private aggregationLoader: DataLoader<string, any>;
  private viewerStateLoader: DataLoader<string, any>;
  private actorViewerStateLoader: DataLoader<string, any>;
  private threadGateLoader: DataLoader<string, any>;
  private postGateLoader: DataLoader<string, any>;
  private labelLoader: DataLoader<string, any[]>;
  
  constructor() {
    // Initialize DataLoaders with batching and caching
    this.postLoader = this.createPostLoader();
    this.userLoader = this.createUserLoader();
    this.aggregationLoader = this.createAggregationLoader();
    this.viewerStateLoader = this.createViewerStateLoader();
    this.actorViewerStateLoader = this.createActorViewerStateLoader();
    this.threadGateLoader = this.createThreadGateLoader();
    this.postGateLoader = this.createPostGateLoader();
    this.labelLoader = this.createLabelLoader();
  }

  /**
   * Clear all DataLoader caches - useful for testing or when data changes
   */
  clearAll() {
    this.postLoader.clearAll();
    this.userLoader.clearAll();
    this.aggregationLoader.clearAll();
    this.viewerStateLoader.clearAll();
    this.actorViewerStateLoader.clearAll();
    this.threadGateLoader.clearAll();
    this.postGateLoader.clearAll();
    this.labelLoader.clearAll();
  }

  /**
   * Load multiple posts with their full hydration data
   */
  async loadPosts(postUris: string[], viewerDid?: string) {
    // Load posts in parallel
    const posts = await Promise.all(
      postUris.map(uri => this.postLoader.load(uri))
    );

    // Filter out null results
    const validPosts = posts.filter(Boolean);
    
    // Collect all author DIDs for batch loading
    const authorDids = [...new Set(validPosts.map(p => p.authorDid))];
    
    // Load all related data in parallel
    const [authors, aggregations, viewerStates, labels] = await Promise.all([
      Promise.all(authorDids.map(did => this.userLoader.load(did))),
      Promise.all(validPosts.map(p => this.aggregationLoader.load(p.uri))),
      viewerDid ? Promise.all(validPosts.map(p => this.viewerStateLoader.load(`${p.uri}:${viewerDid}`))) : [],
      Promise.all(validPosts.map(p => this.labelLoader.load(p.uri)))
    ]);

    // Create lookup maps
    const authorMap = new Map(authors.map((a, i) => [authorDids[i], a]));
    const aggregationMap = new Map(validPosts.map((p, i) => [p.uri, aggregations[i]]));
    const viewerStateMap = new Map(validPosts.map((p, i) => [p.uri, viewerStates[i]]));
    const labelMap = new Map(validPosts.map((p, i) => [p.uri, labels[i]]));

    return {
      posts: validPosts,
      authors: authorMap,
      aggregations: aggregationMap,
      viewerStates: viewerStateMap,
      labels: labelMap
    };
  }

  /**
   * Create DataLoader for posts
   */
  private createPostLoader() {
    return new DataLoader<string, any>(
      async (uris) => {
        if (uris.length === 0) return [];
        
        const result = await db
          .select()
          .from(posts)
          .where(inArray(posts.uri, uris as string[]));
        
        const postMap = new Map(result.map(p => [p.uri, p]));
        return uris.map(uri => postMap.get(uri) || null);
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  /**
   * Create DataLoader for users
   */
  private createUserLoader() {
    return new DataLoader<string, any>(
      async (dids) => {
        if (dids.length === 0) return [];
        
        const result = await db
          .select()
          .from(users)
          .where(inArray(users.did, dids as string[]));
        
        const userMap = new Map(result.map(u => [u.did, u]));
        return dids.map(did => userMap.get(did) || null);
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  /**
   * Create DataLoader for post aggregations
   */
  private createAggregationLoader() {
    return new DataLoader<string, any>(
      async (uris) => {
        if (uris.length === 0) return [];
        
        const result = await db
          .select()
          .from(postAggregations)
          .where(inArray(postAggregations.postUri, uris as string[]));
        
        const aggMap = new Map(result.map(a => [a.postUri, a]));
        
        // Return default aggregation for posts without data
        return uris.map(uri => aggMap.get(uri) || {
          postUri: uri,
          likeCount: 0,
          repostCount: 0,
          replyCount: 0,
          quoteCount: 0,
          bookmarkCount: 0
        });
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  /**
   * Create DataLoader for viewer states (combined uri:viewerDid key)
   */
  private createViewerStateLoader() {
    return new DataLoader<string, any>(
      async (keys) => {
        // Parse combined keys
        const queries = keys.map(key => {
          const [uri, viewerDid] = (key as string).split(':');
          return { uri, viewerDid };
        });

        if (queries.length === 0) return [];

        // Build query conditions - use simpler inArray approach
        // Also fetch likes, reposts, bookmarks for viewer
        const postUris = [...new Set(queries.map(q => q.uri).filter(Boolean))];
        const viewerDids = [...new Set(queries.map(q => q.viewerDid).filter(Boolean))];

        const result = postUris.length > 0 && viewerDids.length > 0
          ? await db
              .select()
              .from(postViewerStates)
              .where(and(
                inArray(postViewerStates.postUri, postUris),
                inArray(postViewerStates.viewerDid, viewerDids)
              )!)
          : [];

        const [likesResult, repostsResult, bookmarksResult] = await Promise.all([
          postUris.length > 0 && viewerDids.length > 0 
            ? db.select()
                .from(likes)
                .where(and(
                  inArray(likes.postUri, postUris),
                  inArray(likes.userDid, viewerDids)
                )!)
            : [],
          postUris.length > 0 && viewerDids.length > 0
            ? db.select()
                .from(reposts)
                .where(and(
                  inArray(reposts.postUri, postUris),
                  inArray(reposts.userDid, viewerDids)
                )!)
            : [],
          postUris.length > 0 && viewerDids.length > 0
            ? db.select()
                .from(bookmarks)
                .where(and(
                  inArray(bookmarks.postUri, postUris),
                  inArray(bookmarks.userDid, viewerDids)
                )!)
            : []
        ]);

        // Create lookup maps
        const stateMap = new Map(result.map(s => [`${s.postUri}:${s.viewerDid}`, s]));
        const likeMap = new Map(likesResult.map(l => [`${l.postUri}:${l.userDid}`, true]));
        const repostMap = new Map(repostsResult.map(r => [`${r.postUri}:${r.userDid}`, r.uri]));
        const bookmarkMap = new Map(bookmarksResult.map(b => [`${b.postUri}:${b.userDid}`, true]));

        return keys.map(key => {
          const state = stateMap.get(key as string);
          const liked = likeMap.has(key as string);
          const repostUri = repostMap.get(key as string);
          const bookmarked = bookmarkMap.has(key as string);

          return {
            liked,
            reposted: !!repostUri,
            repostUri,
            bookmarked,
            muted: state?.muted || false,
            replyDisabled: state?.replyDisabled || false
          };
        });
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  /**
   * Create DataLoader for actor viewer states (follow/block/mute relationships)
   */
  private createActorViewerStateLoader() {
    return new DataLoader<string, any>(
      async (keys) => {
        // Parse combined keys
        const queries = keys.map(key => {
          const [actorDid, viewerDid] = (key as string).split(':');
          return { actorDid, viewerDid };
        });

        if (queries.length === 0) return [];

        const actorDids = [...new Set(queries.map(q => q.actorDid).filter(Boolean))];
        const viewerDids = [...new Set(queries.map(q => q.viewerDid).filter(Boolean))];

        // Fetch all relationship data in parallel
        const [followsResult, blocksResult, mutesResult] = await Promise.all([
          actorDids.length > 0 && viewerDids.length > 0
            ? db.select()
                .from(follows)
                .where(and(
                  inArray(follows.followedDid, actorDids),
                  inArray(follows.followerDid, viewerDids)
                )!)
            : [],
          actorDids.length > 0 && viewerDids.length > 0
            ? db.select()
                .from(blocks)
                .where(
                  or(
                    and(
                      inArray(blocks.blockedDid, actorDids),
                      inArray(blocks.blockerDid, viewerDids)
                    ),
                    and(
                      inArray(blocks.blockedDid, viewerDids),
                      inArray(blocks.blockerDid, actorDids)
                    )
                  )
                )
            : [],
          actorDids.length > 0 && viewerDids.length > 0
            ? db.select()
                .from(mutes)
                .where(and(
                  inArray(mutes.mutedDid, actorDids),
                  inArray(mutes.muterDid, viewerDids)
                )!)
            : []
        ]);

        // Create lookup maps
        const followMap = new Map(followsResult.map(f => [`${f.followedDid}:${f.followerDid}`, f.uri]));
        const blockingMap = new Map(blocksResult
          .filter(b => viewerDids.includes(b.blockerDid))
          .map(b => [`${b.blockedDid}:${b.blockerDid}`, true]));
        const blockedByMap = new Map(blocksResult
          .filter(b => actorDids.includes(b.blockerDid))
          .map(b => [`${b.blockerDid}:${b.blockedDid}`, true]));
        const muteMap = new Map(mutesResult.map(m => [`${m.mutedDid}:${m.muterDid}`, true]));

        return keys.map(key => {
          const followUri = followMap.get(key as string);
          const blocking = blockingMap.has(key as string);
          const blockedBy = blockedByMap.has(key as string);
          const muted = muteMap.has(key as string);

          return {
            following: !!followUri,
            followingUri: followUri,
            blocking,
            blockedBy,
            muted
          };
        });
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  /**
   * Create DataLoader for thread gates
   */
  private createThreadGateLoader() {
    return new DataLoader<string, any>(
      async (uris) => {
        if (uris.length === 0) return [];
        
        const result = await db
          .select()
          .from(threadGates)
          .where(inArray(threadGates.postUri, uris as string[]));
        
        const gateMap = new Map(result.map(g => [g.postUri, g]));
        return uris.map(uri => gateMap.get(uri) || null);
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  /**
   * Create DataLoader for post gates
   */
  private createPostGateLoader() {
    return new DataLoader<string, any>(
      async (uris) => {
        if (uris.length === 0) return [];
        
        const result = await db
          .select()
          .from(postGates)
          .where(inArray(postGates.postUri, uris as string[]));
        
        const gateMap = new Map(result.map(g => [g.postUri, g]));
        return uris.map(uri => gateMap.get(uri) || null);
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  /**
   * Create DataLoader for labels
   */
  private createLabelLoader() {
    return new DataLoader<string, any[]>(
      async (uris) => {
        if (uris.length === 0) return [];
        
        const result = await db
          .select()
          .from(labelsTable)
          .where(inArray(labelsTable.uri, uris as string[]));
        
        // Group labels by URI
        const labelMap = new Map<string, any[]>();
        for (const label of result) {
          const existing = labelMap.get(label.uri) || [];
          existing.push(label);
          labelMap.set(label.uri, existing);
        }
        
        return uris.map(uri => labelMap.get(uri) || []);
      },
      {
        cache: true,
        batchScheduleFn: (callback) => process.nextTick(callback)
      }
    );
  }

  // Public accessor methods for individual loaders
  get posts() { return this.postLoader; }
  get users() { return this.userLoader; }
  get aggregations() { return this.aggregationLoader; }
  get viewerStates() { return this.viewerStateLoader; }
  get actorViewerStates() { return this.actorViewerStateLoader; }
  get threadGates() { return this.threadGateLoader; }
  get postGates() { return this.postGateLoader; }
  get labels() { return this.labelLoader; }
}

// Singleton instance for request-scoped DataLoader
let dataLoaderInstance: HydrationDataLoader | null = null;

export function getDataLoader(): HydrationDataLoader {
  if (!dataLoaderInstance) {
    dataLoaderInstance = new HydrationDataLoader();
  }
  return dataLoaderInstance;
}

export function createDataLoader(): HydrationDataLoader {
  return new HydrationDataLoader();
}

export function clearDataLoader() {
  if (dataLoaderInstance) {
    dataLoaderInstance.clearAll();
    dataLoaderInstance = null;
  }
}