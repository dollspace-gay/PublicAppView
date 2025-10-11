// Hydrator class matching Bluesky's implementation
import { db } from '../../db';
import { 
  users, posts, reposts, likes, bookmarks, blocks, mutes,
  verifications, activitySubscriptions, statuses, chatDeclarations,
  notificationDeclarations, threadgates, postgates, knownFollowers,
  bidirectionalBlocks, postBlocks
} from '../../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { 
  HydrationState, 
  HydrationMap, 
  Actor, 
  Post, 
  Repost, 
  Like, 
  ProfileViewerState,
  PostViewerState,
  PostAgg,
  ProfileAgg,
  FeedItem,
  ItemRef,
  RecordInfo
} from '../../types';
import { INVALID_HANDLE } from '@atproto/syntax';

export interface HydrateCtx {
  labelers: string[];
  viewer: string | null;
  includeTakedowns?: boolean;
  includeActorTakedowns?: boolean;
  include3pBlocks?: boolean;
}

export class Hydrator {
  constructor() {}

  // Main entry point for hydrating feed items
  async hydrateFeedItems(
    items: FeedItem[],
    ctx: HydrateCtx,
  ): Promise<HydrationState> {
    // Get posts, collect reply refs
    const postUris = items.map(item => item.post.uri);
    const posts = await this.getPosts(postUris, ctx.includeTakedowns);
    
    const rootUris: string[] = [];
    const parentUris: string[] = [];
    
    // Collect reply references
    posts.forEach((post) => {
      if (post?.record.reply) {
        rootUris.push(post.record.reply.root.uri);
        parentUris.push(post.record.reply.parent.uri);
      }
    });

    // Get reply posts
    const replyUris = [...new Set([...rootUris, ...parentUris])];
    const replies = await this.getPosts(replyUris, ctx.includeTakedowns);

    // Get repost URIs and their authors
    const repostUris = items
      .map(item => item.repost?.uri)
      .filter(Boolean) as string[];
    
    const reposts = await this.getReposts(repostUris, ctx.includeTakedowns);
    
    // Get all author DIDs
    const authorDids = new Set<string>();
    posts.forEach(post => {
      if (post) authorDids.add(post.authorDid);
    });
    replies.forEach(reply => {
      if (reply) authorDids.add(reply.authorDid);
    });
    reposts.forEach(repost => {
      if (repost) authorDids.add(repost.authorDid);
    });

    // Hydrate actors
    const actors = await this.getActors(Array.from(authorDids), ctx);
    
    // Hydrate profile viewers if viewer is authenticated
    const profileViewers = ctx.viewer 
      ? await this.getProfileViewerStates(Array.from(authorDids), ctx.viewer)
      : new Map();

    // Hydrate post aggregations
    const postAggs = await this.getPostAggregations(postUris);
    
    // Hydrate labels
    const labels = await this.getLabelsForSubjects(postUris);

    return {
      actors,
      posts: this.mergeMaps(posts, replies),
      reposts,
      profileViewers,
      postAggs,
      labels,
      ctx,
    };
  }

  // Get actors (users) with proper Bluesky structure
  private async getActors(dids: string[], ctx: HydrateCtx): Promise<HydrationMap<Actor>> {
    if (dids.length === 0) return new HydrationMap();

    const usersData = await db
      .select()
      .from(users)
      .where(inArray(users.did, dids));

    const actors = new HydrationMap<Actor>();
    
    for (const user of usersData) {
      const actor: Actor = {
        did: user.did,
        handle: user.handle ?? INVALID_HANDLE,
        profile: user.profileRecord as any,
        profileCid: user.profileCid || undefined,
        profileTakedownRef: user.profileTakedownRef || undefined,
        sortedAt: user.sortedAt || undefined,
        indexedAt: user.indexedAt || undefined,
        takedownRef: user.takedownRef || undefined,
        isLabeler: user.isLabeler || false,
        allowIncomingChatsFrom: user.allowIncomingChatsFrom || 'none',
        upstreamStatus: user.upstreamStatus || undefined,
        createdAt: user.createdAt || undefined,
        priorityNotifications: user.priorityNotifications || false,
        trustedVerifier: user.trustedVerifier || false,
        verifications: [], // TODO: Implement verifications
        allowActivitySubscriptionsFrom: user.allowActivitySubscriptionsFrom || 'none',
      };
      
      actors.set(user.did, actor);
    }

    return actors;
  }

  // Get posts with proper structure
  private async getPosts(uris: string[], includeTakedowns?: boolean): Promise<HydrationMap<Post>> {
    if (uris.length === 0) return new HydrationMap();

    const postsData = await db
      .select()
      .from(posts)
      .where(inArray(posts.uri, uris));

    const postsMap = new HydrationMap<Post>();
    
    for (const post of postsData) {
      const postRecord: Post = {
        uri: post.uri,
        cid: post.cid,
        record: {
          $type: 'app.bsky.feed.post',
          text: post.text,
          reply: post.parentUri ? {
            root: { uri: post.rootUri || post.parentUri, cid: '' },
            parent: { uri: post.parentUri, cid: '' },
          } : undefined,
          embed: post.embed as any,
          facets: undefined,
          labels: undefined,
          tags: post.tags as string[] || [],
          createdAt: post.createdAt.toISOString(),
        },
        authorDid: post.authorDid,
        violatesThreadGate: post.violatesThreadGate || false,
        violatesEmbeddingRules: post.violatesEmbeddingRules || false,
        hasThreadGate: post.hasThreadGate || false,
        hasPostGate: post.hasPostGate || false,
        tags: new Set(post.tags as string[] || []),
        sortedAt: post.indexedAt,
        indexedAt: post.indexedAt,
        takedownRef: undefined,
      };
      
      postsMap.set(post.uri, postRecord);
    }

    return postsMap;
  }

  // Get reposts
  private async getReposts(uris: string[], includeTakedowns?: boolean): Promise<HydrationMap<Repost>> {
    if (uris.length === 0) return new HydrationMap();

    const repostsData = await db
      .select()
      .from(reposts)
      .where(inArray(reposts.uri, uris));

    const repostsMap = new HydrationMap<Repost>();
    
    for (const repost of repostsData) {
      const repostRecord: Repost = {
        uri: repost.uri,
        cid: repost.cid,
        record: {
          $type: 'app.bsky.feed.repost',
          subject: { uri: repost.postUri, cid: '' },
          createdAt: repost.createdAt.toISOString(),
        },
        authorDid: repost.userDid,
        sortedAt: repost.createdAt,
        indexedAt: repost.indexedAt,
        takedownRef: undefined,
      };
      
      repostsMap.set(repost.uri, repostRecord);
    }

    return repostsMap;
  }

  // Get profile viewer states
  private async getProfileViewerStates(
    actorDids: string[],
    viewerDid: string
  ): Promise<Map<string, ProfileViewerState>> {
    const result = new Map<string, ProfileViewerState>();

    // Get blocking relationships
    const blocking = await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.blockerDid, viewerDid),
          inArray(blocks.blockedDid, actorDids)
        )
      );

    const blockedBy = await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.blockedDid, viewerDid),
          inArray(blocks.blockerDid, actorDids)
        )
      );

    // Get muting relationships
    const muting = await db
      .select()
      .from(mutes)
      .where(
        and(
          eq(mutes.muterDid, viewerDid),
          inArray(mutes.mutedDid, actorDids)
        )
      );

    // Build relationship map
    for (const did of actorDids) {
      const state: ProfileViewerState = {};
      
      if (blocking.some(b => b.blockedDid === did)) {
        state.blocking = true;
      }
      
      if (blockedBy.some(b => b.blockerDid === did)) {
        state.blockedBy = true;
      }
      
      if (muting.some(m => m.mutedDid === did)) {
        state.muted = true;
      }

      result.set(did, state);
    }

    return result;
  }

  // Get post aggregations
  private async getPostAggregations(postUris: string[]): Promise<Map<string, PostAgg>> {
    if (postUris.length === 0) return new Map();

    const aggregations = await db
      .select()
      .from(sql`post_aggregations`)
      .where(inArray(sql`post_uri`, postUris));

    const result = new Map<string, PostAgg>();
    
    for (const agg of aggregations) {
      result.set(agg.postUri, {
        likes: agg.likeCount || 0,
        replies: agg.replyCount || 0,
        reposts: agg.repostCount || 0,
        quotes: agg.quoteCount || 0,
        bookmarks: agg.bookmarkCount || 0,
      });
    }

    return result;
  }

  // Get labels for subjects
  private async getLabelsForSubjects(subjects: string[]): Promise<Map<string, any[]>> {
    // TODO: Implement label fetching
    return new Map();
  }

  // Merge two hydration maps
  private mergeMaps<T>(mapA: HydrationMap<T>, mapB: HydrationMap<T>): HydrationMap<T> {
    const result = new HydrationMap<T>();
    
    mapA.forEach((value, key) => {
      result.set(key, value);
    });
    
    mapB.forEach((value, key) => {
      result.set(key, value);
    });
    
    return result;
  }

  // Hydrate profiles (actors) for a list of DIDs
  async hydrateProfiles(
    dids: string[],
    ctx: HydrateCtx,
  ): Promise<HydrationState> {
    const actors = await this.getActors(dids, ctx);
    const profileViewers = ctx.viewer 
      ? await this.getProfileViewerStates(dids, ctx.viewer)
      : new Map();
    const labels = await this.getLabelsForSubjects(dids);

    return {
      actors,
      profileViewers,
      labels,
      ctx,
    };
  }

  // Hydrate posts for a list of URIs
  async hydratePosts(
    refs: ItemRef[],
    ctx: HydrateCtx,
    state: HydrationState = {},
  ): Promise<HydrationState> {
    const uris = refs.map(ref => ref.uri);
    const posts = await this.getPosts(uris, ctx.includeTakedowns);
    
    // Get all author DIDs
    const authorDids = new Set<string>();
    posts.forEach(post => {
      if (post) authorDids.add(post.authorDid);
    });

    // Hydrate actors for post authors
    const actors = await this.getActors(Array.from(authorDids), ctx);
    
    // Hydrate profile viewers if viewer is authenticated
    const profileViewers = ctx.viewer 
      ? await this.getProfileViewerStates(Array.from(authorDids), ctx.viewer)
      : new Map();

    // Hydrate post aggregations
    const postAggs = await this.getPostAggregations(uris);
    
    // Hydrate labels
    const labels = await this.getLabelsForSubjects(uris);

    return {
      ...state,
      posts,
      actors,
      profileViewers,
      postAggs,
      labels,
      ctx,
    };
  }
}