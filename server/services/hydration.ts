import { db } from '../db';
import { posts, reposts, likes, bookmarks, users, blocks, mutes } from '../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { HydrationState, ProfileViewerState, FeedItem } from '../types/feed';

export class Hydrator {
  async hydrateFeedItems(
    items: FeedItem[],
    viewerDid?: string
  ): Promise<HydrationState> {
    const postUris = items.map(item => item.post.uri);
    const repostUris = items
      .map(item => item.repost?.uri)
      .filter(Boolean) as string[];

    // Hydrate posts
    const postsData = await this.hydratePosts(postUris);
    
    // Hydrate reposts
    const repostsData = await this.hydrateReposts(repostUris);
    
    // Hydrate profile viewers if viewer is authenticated
    // Extract author DIDs from hydrated posts (not post URIs)
    const authorDids = Array.from(new Set(
      Array.from(postsData.values()).map((post: any) => post.author?.did).filter(Boolean)
    ));
    
    const profileViewers = viewerDid 
      ? await this.hydrateProfileViewers(authorDids, viewerDid)
      : new Map();

    return {
      posts: postsData,
      reposts: repostsData,
      profileViewers,
    };
  }

  async hydrateProfileViewers(
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
        state.muting = true;
      }

      result.set(did, state);
    }

    return result;
  }

  private async hydratePosts(postUris: string[]): Promise<Map<string, any>> {
    if (postUris.length === 0) return new Map();

    const postsData = await db
      .select()
      .from(posts)
      .where(inArray(posts.uri, postUris));

    const result = new Map();
    for (const post of postsData) {
      result.set(post.uri, {
        uri: post.uri,
        cid: post.cid,
        record: {
          text: post.text,
          reply: post.parentUri ? {
            parent: { uri: post.parentUri },
            root: post.rootUri ? { uri: post.rootUri } : undefined,
          } : undefined,
          embed: post.embed,
        },
        author: {
          did: post.authorDid,
        },
        createdAt: post.createdAt.toISOString(),
        indexedAt: post.indexedAt.toISOString(),
      });
    }

    return result;
  }

  private async hydrateReposts(repostUris: string[]): Promise<Map<string, any>> {
    if (repostUris.length === 0) return new Map();

    const repostsData = await db
      .select()
      .from(reposts)
      .where(inArray(reposts.uri, repostUris));

    const result = new Map();
    for (const repost of repostsData) {
      result.set(repost.uri, {
        uri: repost.uri,
        cid: repost.uri, // Using URI as CID for reposts
        record: {
          subject: { uri: repost.postUri },
        },
        createdAt: repost.createdAt.toISOString(),
        indexedAt: repost.indexedAt.toISOString(),
      });
    }

    return result;
  }

  async hydrateProfileViewersForActors(
    actorDids: string[],
    viewerDid?: string
  ): Promise<Map<string, ProfileViewerState>> {
    if (!viewerDid || actorDids.length === 0) {
      return new Map();
    }

    return this.hydrateProfileViewers(actorDids, viewerDid);
  }
}