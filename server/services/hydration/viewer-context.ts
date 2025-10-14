import { db } from '../../db';
import { 
  users, 
  blocks, 
  mutes, 
  follows, 
  userPreferences,
  listMutes,
  threadMutes
} from '../../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';

export interface ViewerContext {
  did: string;
  following: Set<string>;
  followers: Set<string>;
  blocking: Set<string>;
  blockedBy: Set<string>;
  muting: Set<string>;
  mutedByLists: Map<string, string[]>; // did -> list URIs
  threadMutes: Set<string>; // thread URIs
  listMemberships: Map<string, string[]>; // list URI -> member DIDs
  preferences?: any;
}

export class ViewerContextBuilder {
  /**
   * Build comprehensive viewer context for a given DID
   * This includes all relationships and preferences needed for view construction
   */
  async build(viewerDid: string): Promise<ViewerContext> {
    const [
      followingData,
      followersData,
      blockingData,
      blockedByData,
      mutingData,
      threadMutesData,
      listMutesData,
      preferencesData
    ] = await Promise.all([
      // Following
      db.select({ followingDid: follows.followingDid })
        .from(follows)
        .where(eq(follows.followerDid, viewerDid)),
      
      // Followers  
      db.select({ followerDid: follows.followerDid })
        .from(follows)
        .where(eq(follows.followingDid, viewerDid)),
      
      // Blocking
      db.select({ blockedDid: blocks.blockedDid })
        .from(blocks)
        .where(eq(blocks.blockerDid, viewerDid)),
      
      // Blocked by
      db.select({ blockerDid: blocks.blockerDid })
        .from(blocks)
        .where(eq(blocks.blockedDid, viewerDid)),
      
      // Muting
      db.select({ mutedDid: mutes.mutedDid })
        .from(mutes)
        .where(eq(mutes.muterDid, viewerDid)),
      
      // Thread mutes
      db.select({ threadRootUri: threadMutes.threadRootUri })
        .from(threadMutes)
        .where(eq(threadMutes.muterDid, viewerDid)),
      
      // List mutes
      db.select({ listUri: listMutes.listUri })
        .from(listMutes)
        .where(eq(listMutes.muterDid, viewerDid)),
      
      // Preferences
      db.select()
        .from(userPreferences)
        .where(eq(userPreferences.userDid, viewerDid))
        .limit(1)
    ]);

    // Build mutedByLists map by fetching list members
    const mutedByLists = new Map<string, string[]>();
    const listMemberships = new Map<string, string[]>();
    
    if (listMutesData.length > 0) {
      const mutedListUris = listMutesData.map(l => l.listUri);
      const listMembersData = await db
        .select({ listUri: sql<string>`list_uri`, memberDid: sql<string>`member_did` })
        .from(sql`list_members`)
        .where(inArray(sql`list_uri`, mutedListUris));
      
      // Group members by list
      for (const member of listMembersData) {
        if (!listMemberships.has(member.listUri)) {
          listMemberships.set(member.listUri, []);
        }
        listMemberships.get(member.listUri)!.push(member.memberDid);
        
        // Also build reverse mapping for muted actors
        if (!mutedByLists.has(member.memberDid)) {
          mutedByLists.set(member.memberDid, []);
        }
        mutedByLists.get(member.memberDid)!.push(member.listUri);
      }
    }

    return {
      did: viewerDid,
      following: new Set(followingData.map(f => f.followingDid)),
      followers: new Set(followersData.map(f => f.followerDid)),
      blocking: new Set(blockingData.map(b => b.blockedDid)),
      blockedBy: new Set(blockedByData.map(b => b.blockerDid)),
      muting: new Set(mutingData.map(m => m.mutedDid)),
      mutedByLists,
      threadMutes: new Set(threadMutesData.map(t => t.threadRootUri)),
      listMemberships,
      preferences: preferencesData[0]
    };
  }

  /**
   * Build viewer states for a set of actors
   * Returns a map of DID -> viewer relationship state
   */
  async buildActorStates(
    viewerDid: string,
    actorDids: string[]
  ): Promise<Map<string, any>> {
    if (actorDids.length === 0) return new Map();

    const ctx = await this.build(viewerDid);
    const result = new Map();

    // Get follow URIs for actors
    const followingUris = await db
      .select({ 
        followingDid: follows.followingDid, 
        uri: follows.uri 
      })
      .from(follows)
      .where(
        and(
          eq(follows.followerDid, viewerDid),
          inArray(follows.followingDid, actorDids)
        )
      );

    const followedByUris = await db
      .select({ 
        followerDid: follows.followerDid, 
        uri: follows.uri 
      })
      .from(follows)
      .where(
        and(
          eq(follows.followingDid, viewerDid),
          inArray(follows.followerDid, actorDids)
        )
      );

    const blockingUris = await db
      .select({ 
        blockedDid: blocks.blockedDid, 
        uri: blocks.uri 
      })
      .from(blocks)
      .where(
        and(
          eq(blocks.blockerDid, viewerDid),
          inArray(blocks.blockedDid, actorDids)
        )
      );

    for (const did of actorDids) {
      const state: any = {};

      // Following
      const followingUri = followingUris.find(f => f.followingDid === did)?.uri;
      if (followingUri) {
        state.following = followingUri;
      }

      // Followed by
      const followedByUri = followedByUris.find(f => f.followerDid === did)?.uri;
      if (followedByUri) {
        state.followedBy = followedByUri;
      }

      // Blocking
      const blockingUri = blockingUris.find(b => b.blockedDid === did)?.uri;
      if (blockingUri) {
        state.blocking = blockingUri;
      }

      // Blocked by
      if (ctx.blockedBy.has(did)) {
        state.blockedBy = true;
      }

      // Muting
      if (ctx.muting.has(did)) {
        state.muted = true;
      }

      result.set(did, state);
    }

    return result;
  }

  /**
   * Build viewer states for a set of posts
   * Returns a map of post URI -> viewer state
   */
  async buildPostStates(
    viewerDid: string,
    postUris: string[]
  ): Promise<Map<string, any>> {
    if (postUris.length === 0) return new Map();

    const [likesData, repostsData, bookmarksData] = await Promise.all([
      db.select({ postUri: sql<string>`post_uri`, uri: sql<string>`uri` })
        .from(sql`likes`)
        .where(
          and(
            eq(sql`user_did`, viewerDid),
            inArray(sql`post_uri`, postUris)
          )
        ),
      
      db.select({ postUri: sql<string>`post_uri`, uri: sql<string>`uri` })
        .from(sql`reposts`)
        .where(
          and(
            eq(sql`user_did`, viewerDid),
            inArray(sql`post_uri`, postUris)
          )
        ),
      
      db.select({ postUri: sql<string>`post_uri` })
        .from(sql`bookmarks`)
        .where(
          and(
            eq(sql`user_did`, viewerDid),
            inArray(sql`post_uri`, postUris)
          )
        )
    ]);

    const result = new Map();

    for (const uri of postUris) {
      const state: any = {};

      const like = likesData.find(l => l.postUri === uri);
      if (like) {
        state.likeUri = like.uri;
      }

      const repost = repostsData.find(r => r.postUri === uri);
      if (repost) {
        state.repostUri = repost.uri;
      }

      const bookmark = bookmarksData.find(b => b.postUri === uri);
      if (bookmark) {
        state.bookmarked = true;
      }

      result.set(uri, state);
    }

    return result;
  }
}
