import { db } from '../../db';
import { 
  posts, 
  users, 
  postAggregations, 
  postViewerStates 
} from '../../../shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { ViewerContextBuilder, ViewerContext } from './viewer-context';
import { EmbedResolver } from './embed-resolver';
import { LabelPropagator, Label } from './label-propagator';
import { HydrationCache } from './cache';
import { constellationIntegration } from '../constellation-integration';

export interface HydrationState {
  posts: Map<string, any>;
  actors: Map<string, any>;
  aggregations: Map<string, any>;
  viewerStates: Map<string, any>;
  actorViewerStates: Map<string, any>;
  embeds: Map<string, any>;
  labels: Map<string, Label[]>;
  viewerContext?: ViewerContext;
}

export class EnhancedHydrator {
  private viewerBuilder = new ViewerContextBuilder();
  private embedResolver = new EmbedResolver();
  private labelPropagator = new LabelPropagator();
  private cache = new HydrationCache();

  /**
   * Hydrate posts with full context including viewer states, embeds, and labels
   */
  async hydratePosts(
    postUris: string[],
    viewerDid?: string
  ): Promise<HydrationState> {
    if (postUris.length === 0) {
      return this.emptyState();
    }

    // Build viewer context if authenticated
    const viewerContext = viewerDid 
      ? await this.viewerBuilder.build(viewerDid)
      : undefined;

    // Fetch posts
    const postsData = await db
      .select()
      .from(posts)
      .where(inArray(posts.uri, postUris));

    const postsMap = new Map<string, any>();
    const actorDids = new Set<string>();
    const replyParentUris = new Set<string>();
    const replyRootUris = new Set<string>();

    for (const post of postsData) {
      postsMap.set(post.uri, {
        uri: post.uri,
        cid: post.cid,
        authorDid: post.authorDid,
        text: post.text,
        createdAt: post.createdAt.toISOString(),
        indexedAt: post.indexedAt.toISOString(),
        embed: post.embed,
        reply: post.parentUri ? {
          parent: { uri: post.parentUri },
          root: { uri: post.rootUri || post.parentUri }
        } : undefined,
        tags: post.tags
      });
      actorDids.add(post.authorDid);
      
      // Collect parent and root URIs for reply hydration
      if (post.parentUri) {
        replyParentUris.add(post.parentUri);
        replyRootUris.add(post.rootUri || post.parentUri);
      }
    }

    // Fetch parent and root posts for replies
    if (replyParentUris.size > 0 || replyRootUris.size > 0) {
      try {
        const replyUris = Array.from(new Set([...replyParentUris, ...replyRootUris]));
        console.log(`[HYDRATION] Fetching ${replyUris.length} reply parent/root posts`);
        
        const replyPostsData = await db
          .select()
          .from(posts)
          .where(inArray(posts.uri, replyUris));

        console.log(`[HYDRATION] Found ${replyPostsData.length} reply posts in database`);

        for (const post of replyPostsData) {
          // Only add if not already in the map
          if (!postsMap.has(post.uri)) {
            postsMap.set(post.uri, {
              uri: post.uri,
              cid: post.cid,
              authorDid: post.authorDid,
              text: post.text,
              createdAt: post.createdAt.toISOString(),
              indexedAt: post.indexedAt.toISOString(),
              embed: post.embed,
              reply: post.parentUri ? {
                parent: { uri: post.parentUri },
                root: { uri: post.rootUri || post.parentUri }
              } : undefined,
              tags: post.tags
            });
            actorDids.add(post.authorDid);
          }
        }
        
        // Log missing reply posts
        const foundReplyUris = new Set(replyPostsData.map(p => p.uri));
        const missingReplyUris = replyUris.filter(uri => !foundReplyUris.has(uri));
        if (missingReplyUris.length > 0) {
          console.warn(`[HYDRATION] ${missingReplyUris.length} reply posts not found in database:`, missingReplyUris);
        }
      } catch (error) {
        console.error('[HYDRATION] Error fetching reply posts:', error);
        // Continue without reply posts rather than crashing
      }
    }

    // Fetch aggregations
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
        console.error('[HYDRATION] Error enriching with Constellation stats:', error);
        // Continue with local stats on error
      }
    }

    // Fetch viewer states for posts
    let viewerStatesMap = new Map<string, any>();
    if (viewerDid) {
      viewerStatesMap = await this.viewerBuilder.buildPostStates(viewerDid, postUris);
    }

    // Fetch actors
    const actorsData = await db
      .select()
      .from(users)
      .where(inArray(users.did, Array.from(actorDids)));

    // Check for missing actors
    const actorDidsArray = Array.from(actorDids);
    if (actorsData.length !== actorDidsArray.length) {
      const foundDids = new Set(actorsData.map(a => a.did));
      const missingDids = actorDidsArray.filter(did => !foundDids.has(did));
      console.warn(`[ENHANCED_HYDRATION] ${missingDids.length} actors missing from database:`, missingDids);
    }

    const actorsMap = new Map<string, any>();
    for (const actor of actorsData) {
      actorsMap.set(actor.did, {
        did: actor.did,
        handle: actor.handle,
        displayName: actor.displayName,
        description: actor.description,
        avatarUrl: actor.avatarUrl,
        indexedAt: actor.indexedAt?.toISOString()
      });
    }

    // Fetch viewer states for actors
    let actorViewerStatesMap = new Map<string, any>();
    if (viewerDid) {
      actorViewerStatesMap = await this.viewerBuilder.buildActorStates(
        viewerDid, 
        Array.from(actorDids)
      );
    }

    // Resolve embeds
    const embedsMap = await this.embedResolver.resolveEmbeds(postUris);

    // Fetch labels
    const allSubjects = [...postUris, ...Array.from(actorDids)];
    const labelsMap = await this.labelPropagator.propagateActorLabels(
      Array.from(actorDids),
      postUris
    );

    return {
      posts: postsMap,
      actors: actorsMap,
      aggregations: aggregationsMap,
      viewerStates: viewerStatesMap,
      actorViewerStates: actorViewerStatesMap,
      embeds: embedsMap,
      labels: labelsMap,
      viewerContext
    };
  }

  /**
   * Hydrate actors with viewer states
   */
  async hydrateActors(
    actorDids: string[],
    viewerDid?: string
  ): Promise<HydrationState> {
    if (actorDids.length === 0) {
      return this.emptyState();
    }

    const viewerContext = viewerDid 
      ? await this.viewerBuilder.build(viewerDid)
      : undefined;

    // Fetch actors
    const actorsData = await db
      .select()
      .from(users)
      .where(inArray(users.did, actorDids));

    const actorsMap = new Map<string, any>();
    for (const actor of actorsData) {
      actorsMap.set(actor.did, {
        did: actor.did,
        handle: actor.handle,
        displayName: actor.displayName,
        description: actor.description,
        avatarUrl: actor.avatarUrl,
        bannerUrl: actor.bannerUrl,
        indexedAt: actor.indexedAt?.toISOString()
      });
    }

    // Fetch viewer states for actors
    let actorViewerStatesMap = new Map<string, any>();
    if (viewerDid) {
      actorViewerStatesMap = await this.viewerBuilder.buildActorStates(
        viewerDid,
        actorDids
      );
    }

    // Fetch labels
    const labelsMap = await this.labelPropagator.getLabels(actorDids);

    return {
      posts: new Map(),
      actors: actorsMap,
      aggregations: new Map(),
      viewerStates: new Map(),
      actorViewerStates: actorViewerStatesMap,
      embeds: new Map(),
      labels: labelsMap,
      viewerContext
    };
  }

  /**
   * Hydrate with caching
   * Note: Simplified implementation - always performs full hydration for complete state
   * TODO: Implement proper state caching that includes all hydrated data (actors, aggregations, etc.)
   */
  async hydratePostsCached(
    postUris: string[],
    viewerDid?: string
  ): Promise<HydrationState> {
    // For now, always do full hydration to ensure complete state with all maps populated
    // Future optimization: Cache full HydrationState snapshots including actors, aggregations, etc.
    return await this.hydratePosts(postUris, viewerDid);
  }

  /**
   * Clear hydration cache
   */
  async clearCache() {
    this.embedResolver.clearCache();
  }

  private emptyState(): HydrationState {
    return {
      posts: new Map(),
      actors: new Map(),
      aggregations: new Map(),
      viewerStates: new Map(),
      actorViewerStates: new Map(),
      embeds: new Map(),
      labels: new Map()
    };
  }
}

// Export singleton instance
export const enhancedHydrator = new EnhancedHydrator();

// Re-export classes
export { ViewerContextBuilder } from './viewer-context';
export { EmbedResolver } from './embed-resolver';
export { LabelPropagator } from './label-propagator';
export { HydrationCache } from './cache';

// Re-export types
export type { ViewerContext } from './viewer-context';
export type { ResolvedEmbed } from './embed-resolver';
export type { Label } from './label-propagator';
