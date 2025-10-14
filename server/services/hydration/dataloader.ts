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
 * 
 * COMPLETELY REDESIGNED APPROACH (v3):
 * =====================================
 * Previous versions had SQL syntax errors due to:
 * - Complex tuple IN queries that drizzle-orm couldn't handle
 * - Fetch-then-filter approach that was inefficient and error-prone
 * - Improper handling of empty arrays in inArray()
 * 
 * New approach:
 * - Parse composite keys (uri:viewerDid) properly with validation
 * - Guard against empty arrays with early returns
 * - Use simple AND conditions: eq() + inArray() for single viewer (common case)
 * - Fallback to inArray() + inArray() for multiple viewers (rare)
 * - No in-memory filtering - let the database do the work
 * - Cleaner, more maintainable, and generates valid SQL
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
   * COMPLETELY REDESIGNED: Use AND conditions with proper SQL escaping
   */
  private createViewerStateLoader() {
    return new DataLoader<string, any>(
      async (keys) => {
        if (keys.length === 0) return [];

        // Parse combined keys
        const parsedKeys = keys.map(k => {
          const parts = (k as string).split(':');
          return { postUri: parts[0], viewerDid: parts[1], key: k as string };
        });

        // Filter out invalid keys
        const validKeys = parsedKeys.filter(k => k.postUri && k.viewerDid);
        
        if (validKeys.length === 0) {
          return keys.map(() => ({
            liked: false,
            reposted: false,
            repostUri: null,
            bookmarked: false,
            muted: false,
            replyDisabled: false
          }));
        }

        // Get unique values for efficient querying
        const postUris = [...new Set(validKeys.map(k => k.postUri))].filter(Boolean);
        const viewerDids = [...new Set(validKeys.map(k => k.viewerDid))].filter(Boolean);

        // Guard against empty arrays
        if (postUris.length === 0 || viewerDids.length === 0) {
          return keys.map(() => ({
            liked: false,
            reposted: false,
            repostUri: null,
            bookmarked: false,
            muted: false,
            replyDisabled: false
          }));
        }

        // For viewer states, we typically have the SAME viewer for all posts
        // So we can optimize by checking if there's only one viewer
        const singleViewer = viewerDids.length === 1 ? viewerDids[0] : null;

        // Fetch all data in parallel using simple AND queries
        // We've already checked that postUris and viewerDids are non-empty above
        const [likesResult, repostsResult, bookmarksResult, statesResult] = await Promise.all([
          // Use simple AND queries instead of complex tuple IN
          singleViewer
            ? db.select()
                .from(likes)
                .where(and(
                  eq(likes.userDid, singleViewer),
                  inArray(likes.postUri, postUris)
                ))
            : db.select()
                .from(likes)
                .where(and(
                  inArray(likes.userDid, viewerDids),
                  inArray(likes.postUri, postUris)
                )),
          
          singleViewer
            ? db.select()
                .from(reposts)
                .where(and(
                  eq(reposts.userDid, singleViewer),
                  inArray(reposts.postUri, postUris)
                ))
            : db.select()
                .from(reposts)
                .where(and(
                  inArray(reposts.userDid, viewerDids),
                  inArray(reposts.postUri, postUris)
                )),
          
          singleViewer
            ? db.select()
                .from(bookmarks)
                .where(and(
                  eq(bookmarks.userDid, singleViewer),
                  inArray(bookmarks.postUri, postUris)
                ))
            : db.select()
                .from(bookmarks)
                .where(and(
                  inArray(bookmarks.userDid, viewerDids),
                  inArray(bookmarks.postUri, postUris)
                )),
          
          singleViewer
            ? db.select()
                .from(postViewerStates)
                .where(and(
                  eq(postViewerStates.viewerDid, singleViewer),
                  inArray(postViewerStates.postUri, postUris)
                ))
            : db.select()
                .from(postViewerStates)
                .where(and(
                  inArray(postViewerStates.viewerDid, viewerDids),
                  inArray(postViewerStates.postUri, postUris)
                ))
        ]);

        // Create lookup maps using composite keys
        const likeMap = new Map(likesResult.map(l => [`${l.postUri}:${l.userDid}`, true]));
        const repostMap = new Map(repostsResult.map(r => [`${r.postUri}:${r.userDid}`, r.uri]));
        const bookmarkMap = new Map(bookmarksResult.map(b => [`${b.postUri}:${b.userDid}`, true]));
        const stateMap = new Map(statesResult.map(s => [`${s.postUri}:${s.viewerDid}`, s]));

        // Return results in the same order as keys
        return keys.map(key => {
          const state = stateMap.get(key as string);
          const liked = likeMap.has(key as string);
          const repostUri = repostMap.get(key as string);
          const bookmarked = bookmarkMap.has(key as string);

          return {
            liked,
            reposted: !!repostUri,
            repostUri: repostUri || null,
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
   * COMPLETELY REDESIGNED: Use AND conditions with proper SQL
   */
  private createActorViewerStateLoader() {
    return new DataLoader<string, any>(
      async (keys) => {
        if (keys.length === 0) return [];

        // Parse combined keys
        const parsedKeys = keys.map(k => {
          const parts = (k as string).split(':');
          return { actorDid: parts[0], viewerDid: parts[1], key: k as string };
        });

        // Filter out invalid keys
        const validKeys = parsedKeys.filter(k => k.actorDid && k.viewerDid);
        
        if (validKeys.length === 0) {
          return keys.map(() => ({
            following: null,
            followingUri: null,
            followedBy: null,
            blocking: null,
            blockedBy: false,
            muted: false
          }));
        }

        // Get unique values for efficient querying
        const actorDids = [...new Set(validKeys.map(k => k.actorDid))].filter(Boolean);
        const viewerDids = [...new Set(validKeys.map(k => k.viewerDid))].filter(Boolean);

        // Guard against empty arrays
        if (actorDids.length === 0 || viewerDids.length === 0) {
          return keys.map(() => ({
            following: null,
            followingUri: null,
            followedBy: null,
            blocking: null,
            blockedBy: false,
            muted: false
          }));
        }

        // Usually we have the SAME viewer for all actors
        const singleViewer = viewerDids.length === 1 ? viewerDids[0] : null;

        // Fetch all relationship data in parallel using simple AND queries
        // We've already checked that actorDids and viewerDids are non-empty above
        const [followingResult, followedByResult, blocksResult, mutesResult] = await Promise.all([
          // Following: viewer following the actors
          singleViewer
            ? db.select()
                .from(follows)
                .where(and(
                  eq(follows.followerDid, singleViewer),
                  inArray(follows.followingDid, actorDids)
                ))
            : db.select()
                .from(follows)
                .where(and(
                  inArray(follows.followerDid, viewerDids),
                  inArray(follows.followingDid, actorDids)
                )),
          
          // Followed by: actors following the viewer
          singleViewer
            ? db.select()
                .from(follows)
                .where(and(
                  eq(follows.followingDid, singleViewer),
                  inArray(follows.followerDid, actorDids)
                ))
            : db.select()
                .from(follows)
                .where(and(
                  inArray(follows.followingDid, viewerDids),
                  inArray(follows.followerDid, actorDids)
                )),
          
          // Blocks: need to check both directions
          singleViewer
            ? db.select()
                .from(blocks)
                .where(
                  or(
                    and(
                      eq(blocks.blockerDid, singleViewer), 
                      inArray(blocks.blockedDid, actorDids)
                    ),
                    and(
                      eq(blocks.blockedDid, singleViewer), 
                      inArray(blocks.blockerDid, actorDids)
                    )
                  )
                )
            : db.select()
                .from(blocks)
                .where(
                  or(
                    and(
                      inArray(blocks.blockerDid, viewerDids), 
                      inArray(blocks.blockedDid, actorDids)
                    ),
                    and(
                      inArray(blocks.blockedDid, viewerDids), 
                      inArray(blocks.blockerDid, actorDids)
                    )
                  )
                ),
          
          // Mutes: viewer muting the actors
          singleViewer
            ? db.select()
                .from(mutes)
                .where(and(
                  eq(mutes.muterDid, singleViewer),
                  inArray(mutes.mutedDid, actorDids)
                ))
            : db.select()
                .from(mutes)
                .where(and(
                  inArray(mutes.muterDid, viewerDids),
                  inArray(mutes.mutedDid, actorDids)
                ))
        ]);

        // Create lookup maps using composite keys (actorDid:viewerDid)
        const followingMap = new Map(followingResult.map(f => [`${f.followingDid}:${f.followerDid}`, f.uri]));
        const followedByMap = new Map(followedByResult.map(f => [`${f.followerDid}:${f.followingDid}`, f.uri]));
        const blockingMap = new Map(
          blocksResult
            .filter(b => actorDids.includes(b.blockedDid) && viewerDids.includes(b.blockerDid))
            .map(b => [`${b.blockedDid}:${b.blockerDid}`, b.uri])
        );
        const blockedByMap = new Map(
          blocksResult
            .filter(b => actorDids.includes(b.blockerDid) && viewerDids.includes(b.blockedDid))
            .map(b => [`${b.blockerDid}:${b.blockedDid}`, true])
        );
        const muteMap = new Map(mutesResult.map(m => [`${m.mutedDid}:${m.muterDid}`, true]));

        // Return results in the same order as keys
        return keys.map(key => {
          const followingUri = followingMap.get(key as string);
          const followedByUri = followedByMap.get(key as string);
          const blockingUri = blockingMap.get(key as string);
          const blockedBy = blockedByMap.has(key as string);
          const muted = muteMap.has(key as string);

          return {
            following: followingUri || null,
            followingUri: followingUri || null,
            followedBy: followedByUri || null,
            blocking: blockingUri || null,
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
