import { users, posts, likes, reposts, follows, blocks, mutes, listMutes, listBlocks, userPreferences, sessions, userSettings, labels, labelDefinitions, labelEvents, moderationReports, moderationActions, moderatorAssignments, notifications, lists, listItems, type User, type InsertUser, type Post, type InsertPost, type Like, type InsertLike, type Repost, type InsertRepost, type Follow, type InsertFollow, type Block, type InsertBlock, type Mute, type InsertMute, type ListMute, type InsertListMute, type ListBlock, type InsertListBlock, type UserPreferences, type InsertUserPreferences, type Session, type InsertSession, type UserSettings, type InsertUserSettings, type Label, type InsertLabel, type LabelDefinition, type InsertLabelDefinition, type LabelEvent, type InsertLabelEvent, type ModerationReport, type InsertModerationReport, type ModerationAction, type InsertModerationAction, type ModeratorAssignment, type InsertModeratorAssignment, type Notification, type InsertNotification, type List, type InsertList, type ListItem, type InsertListItem } from "@shared/schema";
import { db, pool } from "./db";
import { eq, desc, and, sql, inArray, isNull } from "drizzle-orm";
import { encryptionService } from "./services/encryption";

export interface IStorage {
  // User operations
  getUser(did: string): Promise<User | undefined>;
  getUsers(dids: string[]): Promise<User[]>;
  getUserByHandle(handle: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(did: string, data: Partial<InsertUser>): Promise<User | undefined>;
  getSuggestedUsers(viewerDid?: string, limit?: number): Promise<User[]>;

  // Post operations
  getPost(uri: string): Promise<Post | undefined>;
  getPosts(uris: string[]): Promise<Post[]>;
  createPost(post: InsertPost): Promise<Post>;
  deletePost(uri: string): Promise<void>;
  getAuthorPosts(authorDid: string, limit?: number, cursor?: string): Promise<Post[]>;
  getPostThread(uri: string): Promise<Post[]>;
  getQuotePosts(postUri: string, limit?: number, cursor?: string): Promise<Post[]>;

  // Like operations
  createLike(like: InsertLike): Promise<Like>;
  deleteLike(uri: string): Promise<void>;
  getPostLikes(postUri: string, limit?: number, cursor?: string): Promise<{ likes: Like[], cursor?: string }>;
  getActorLikes(userDid: string, limit?: number, cursor?: string): Promise<{ likes: Like[], cursor?: string }>;

  // Repost operations
  createRepost(repost: InsertRepost): Promise<Repost>;
  deleteRepost(uri: string): Promise<void>;
  getPostReposts(postUri: string, limit?: number, cursor?: string): Promise<{ reposts: Repost[], cursor?: string }>;

  // Follow operations
  createFollow(follow: InsertFollow): Promise<Follow>;
  deleteFollow(uri: string): Promise<void>;
  getFollows(followerDid: string, limit?: number): Promise<Follow[]>;
  getFollowers(followingDid: string, limit?: number): Promise<Follow[]>;
  isFollowing(followerDid: string, followingDid: string): Promise<boolean>;

  // Block operations
  createBlock(block: InsertBlock): Promise<Block>;
  deleteBlock(uri: string): Promise<void>;
  getBlocks(blockerDid: string, limit?: number, cursor?: string): Promise<{ blocks: Block[], cursor?: string }>;
  
  // Mute operations
  createMute(mute: InsertMute): Promise<Mute>;
  deleteMute(uri: string): Promise<void>;
  getMutes(muterDid: string, limit?: number, cursor?: string): Promise<{ mutes: Mute[], cursor?: string }>;
  
  // List mute operations
  createListMute(listMute: InsertListMute): Promise<ListMute>;
  deleteListMute(uri: string): Promise<void>;
  getListMutes(muterDid: string, limit?: number, cursor?: string): Promise<{ mutes: ListMute[], cursor?: string }>;
  
  // List block operations
  createListBlock(listBlock: InsertListBlock): Promise<ListBlock>;
  deleteListBlock(uri: string): Promise<void>;
  getListBlocks(blockerDid: string, limit?: number, cursor?: string): Promise<{ blocks: ListBlock[], cursor?: string }>;
  
  // User preferences operations
  getUserPreferences(userDid: string): Promise<UserPreferences | undefined>;
  createUserPreferences(prefs: InsertUserPreferences): Promise<UserPreferences>;
  updateUserPreferences(userDid: string, prefs: Partial<InsertUserPreferences>): Promise<UserPreferences | undefined>;
  
  // Relationship operations
  getRelationships(viewerDid: string, targetDids: string[]): Promise<Map<string, {
    following: boolean;
    followedBy: boolean;
    blocking: boolean;
    blockedBy: boolean;
    muting: boolean;
  }>>;

  // Session operations
  createSession(session: InsertSession): Promise<Session>;
  getSession(id: string): Promise<Session | undefined>;
  getUserSessions(userDid: string): Promise<Session[]>;
  updateSession(id: string, data: Partial<Pick<InsertSession, 'accessToken' | 'refreshToken' | 'expiresAt'>>): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;

  // User settings operations
  getUserSettings(userDid: string): Promise<UserSettings | undefined>;
  createUserSettings(settings: InsertUserSettings): Promise<UserSettings>;
  updateUserSettings(userDid: string, settings: Partial<InsertUserSettings>): Promise<UserSettings | undefined>;

  // Label operations
  createLabel(label: InsertLabel): Promise<Label>;
  getLabel(uri: string): Promise<Label | undefined>;
  getLabelsForSubject(subject: string): Promise<Label[]>;
  getLabelsForSubjects(subjects: string[]): Promise<Label[]>;
  deleteLabel(uri: string): Promise<void>;
  queryLabels(params: { sources?: string[], subjects?: string[], values?: string[], limit?: number }): Promise<Label[]>;
  
  // Label definition operations
  createLabelDefinition(definition: InsertLabelDefinition): Promise<LabelDefinition>;
  getLabelDefinition(value: string): Promise<LabelDefinition | undefined>;
  getAllLabelDefinitions(): Promise<LabelDefinition[]>;
  updateLabelDefinition(value: string, data: Partial<InsertLabelDefinition>): Promise<LabelDefinition | undefined>;
  
  // Label event operations
  createLabelEvent(event: InsertLabelEvent): Promise<LabelEvent>;
  getRecentLabelEvents(limit?: number, since?: Date): Promise<LabelEvent[]>;

  // Moderation report operations
  createModerationReport(report: InsertModerationReport): Promise<ModerationReport>;
  getModerationReport(id: number): Promise<ModerationReport | undefined>;
  getModerationReportsByStatus(status: string, limit?: number): Promise<ModerationReport[]>;
  getModerationReportsBySubject(subject: string): Promise<ModerationReport[]>;
  getModerationReportsByReporter(reporterDid: string, limit?: number): Promise<ModerationReport[]>;
  updateModerationReportStatus(id: number, status: string): Promise<ModerationReport | undefined>;
  
  // Moderation action operations
  createModerationAction(action: InsertModerationAction): Promise<ModerationAction>;
  getModerationActionsByReport(reportId: number): Promise<ModerationAction[]>;
  getModerationActionsByModerator(moderatorDid: string, limit?: number): Promise<ModerationAction[]>;
  
  // Moderator assignment operations
  assignModerator(assignment: InsertModeratorAssignment): Promise<ModeratorAssignment>;
  getModeratorAssignmentsByReport(reportId: number): Promise<ModeratorAssignment[]>;
  getModeratorAssignmentsByModerator(moderatorDid: string, includeCompleted?: boolean, limit?: number): Promise<ModeratorAssignment[]>;
  completeModeratorAssignment(id: number): Promise<ModeratorAssignment | undefined>;

  // Timeline operations
  getTimeline(userDid: string, limit?: number, cursor?: string): Promise<Post[]>;
  
  // Notification operations
  createNotification(notification: InsertNotification): Promise<Notification>;
  getNotifications(recipientDid: string, limit?: number, cursor?: string): Promise<Notification[]>;
  getUnreadNotificationCount(recipientDid: string): Promise<number>;
  markNotificationsAsRead(recipientDid: string, seenAt?: Date): Promise<void>;

  // List operations
  createList(list: InsertList): Promise<List>;
  deleteList(uri: string): Promise<void>;
  getList(uri: string): Promise<List | undefined>;
  getUserLists(creatorDid: string, limit?: number): Promise<List[]>;
  
  // List item operations
  createListItem(item: InsertListItem): Promise<ListItem>;
  deleteListItem(uri: string): Promise<void>;
  getListItems(listUri: string, limit?: number): Promise<ListItem[]>;
  getListFeed(listUri: string, limit?: number, cursor?: string): Promise<Post[]>;
  
  // Stats
  getStats(): Promise<{
    totalUsers: number;
    totalPosts: number;
    totalLikes: number;
    totalReposts: number;
    totalFollows: number;
    totalBlocks: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(did: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.did, did));
    return user || undefined;
  }

  async getUserByHandle(handle: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.handle, handle));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .onConflictDoUpdate({
        target: users.did,
        set: {
          handle: insertUser.handle,
          displayName: insertUser.displayName,
          avatarUrl: insertUser.avatarUrl,
          description: insertUser.description,
        },
      })
      .returning();
    return user;
  }

  async updateUser(did: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set(data)
      .where(eq(users.did, did))
      .returning();
    return user || undefined;
  }

  async getUsers(dids: string[]): Promise<User[]> {
    if (dids.length === 0) return [];
    return await db.select().from(users).where(inArray(users.did, dids));
  }

  async getSuggestedUsers(viewerDid?: string, limit = 25): Promise<User[]> {
    if (viewerDid) {
      const followedDids = await db
        .select({ did: follows.followingDid })
        .from(follows)
        .where(eq(follows.followerDid, viewerDid));
      
      const followedDidList = followedDids.map(f => f.did);
      
      if (followedDidList.length > 0) {
        return await db
          .select()
          .from(users)
          .where(and(
            sql`${users.did} != ${viewerDid}`,
            sql`${users.did} NOT IN (${sql.join(followedDidList.map(did => sql`${did}`), sql`, `)})`
          ))
          .orderBy(desc(users.createdAt))
          .limit(limit);
      }
    }
    
    return await db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit);
  }

  async getPost(uri: string): Promise<Post | undefined> {
    const [post] = await db.select().from(posts).where(eq(posts.uri, uri));
    return post || undefined;
  }

  async createPost(post: InsertPost): Promise<Post> {
    const [newPost] = await db
      .insert(posts)
      .values(post)
      .onConflictDoNothing()
      .returning();
    return newPost;
  }

  async deletePost(uri: string): Promise<void> {
    await db.delete(posts).where(eq(posts.uri, uri));
  }

  async getAuthorPosts(authorDid: string, limit = 50, cursor?: string): Promise<Post[]> {
    const conditions = [eq(posts.authorDid, authorDid)];
    
    if (cursor) {
      conditions.push(sql`${posts.indexedAt} < ${cursor}`);
    }

    return await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.indexedAt))
      .limit(limit);
  }

  async getPostThread(uri: string): Promise<Post[]> {
    const rootPost = await this.getPost(uri);
    if (!rootPost) return [];

    const replies = await db
      .select()
      .from(posts)
      .where(eq(posts.rootUri, rootPost.rootUri || uri))
      .orderBy(posts.createdAt);

    return [rootPost, ...replies.filter(p => p.uri !== uri)];
  }

  async getPosts(uris: string[]): Promise<Post[]> {
    if (uris.length === 0) return [];
    return await db.select().from(posts).where(inArray(posts.uri, uris));
  }

  async getQuotePosts(postUri: string, limit = 50, cursor?: string): Promise<Post[]> {
    const conditions = [sql`${posts.embed}->>'$type' = 'app.bsky.embed.record' AND ${posts.embed}->'record'->>'uri' = ${postUri}`];
    
    if (cursor) {
      conditions.push(sql`${posts.indexedAt} < ${cursor}`);
    }

    return await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.indexedAt))
      .limit(limit);
  }

  async createLike(like: InsertLike): Promise<Like> {
    const [newLike] = await db
      .insert(likes)
      .values(like)
      .onConflictDoNothing()
      .returning();
    return newLike;
  }

  async deleteLike(uri: string): Promise<void> {
    await db.delete(likes).where(eq(likes.uri, uri));
  }

  async getPostLikes(postUri: string, limit = 100, cursor?: string): Promise<{ likes: Like[], cursor?: string }> {
    const conditions = [eq(likes.postUri, postUri)];
    
    if (cursor) {
      conditions.push(sql`${likes.indexedAt} < ${cursor}`);
    }

    const results = await db
      .select()
      .from(likes)
      .where(and(...conditions))
      .orderBy(desc(likes.indexedAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;

    return { likes: items, cursor: nextCursor };
  }

  async getActorLikes(userDid: string, limit = 50, cursor?: string): Promise<{ likes: Like[], cursor?: string }> {
    const conditions = [eq(likes.userDid, userDid)];
    
    if (cursor) {
      conditions.push(sql`${likes.indexedAt} < ${cursor}`);
    }

    const results = await db
      .select()
      .from(likes)
      .where(and(...conditions))
      .orderBy(desc(likes.indexedAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;

    return { likes: items, cursor: nextCursor };
  }

  async createRepost(repost: InsertRepost): Promise<Repost> {
    const [newRepost] = await db
      .insert(reposts)
      .values(repost)
      .onConflictDoNothing()
      .returning();
    return newRepost;
  }

  async deleteRepost(uri: string): Promise<void> {
    await db.delete(reposts).where(eq(reposts.uri, uri));
  }

  async getPostReposts(postUri: string, limit = 100, cursor?: string): Promise<{ reposts: Repost[], cursor?: string }> {
    const conditions = [eq(reposts.postUri, postUri)];
    
    if (cursor) {
      conditions.push(sql`${reposts.indexedAt} < ${cursor}`);
    }

    const results = await db
      .select()
      .from(reposts)
      .where(and(...conditions))
      .orderBy(desc(reposts.indexedAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;

    return { reposts: items, cursor: nextCursor };
  }

  async createFollow(follow: InsertFollow): Promise<Follow> {
    const [newFollow] = await db
      .insert(follows)
      .values(follow)
      .onConflictDoNothing()
      .returning();
    return newFollow;
  }

  async deleteFollow(uri: string): Promise<void> {
    await db.delete(follows).where(eq(follows.uri, uri));
  }

  async getFollows(followerDid: string, limit = 100): Promise<Follow[]> {
    return await db
      .select()
      .from(follows)
      .where(eq(follows.followerDid, followerDid))
      .limit(limit);
  }

  async getFollowers(followingDid: string, limit = 100): Promise<Follow[]> {
    return await db
      .select()
      .from(follows)
      .where(eq(follows.followingDid, followingDid))
      .limit(limit);
  }

  async isFollowing(followerDid: string, followingDid: string): Promise<boolean> {
    const [follow] = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerDid, followerDid),
          eq(follows.followingDid, followingDid)
        )
      );
    return !!follow;
  }

  async createBlock(block: InsertBlock): Promise<Block> {
    const [newBlock] = await db
      .insert(blocks)
      .values(block)
      .onConflictDoNothing()
      .returning();
    return newBlock;
  }

  async deleteBlock(uri: string): Promise<void> {
    await db.delete(blocks).where(eq(blocks.uri, uri));
  }

  async getBlocks(blockerDid: string, limit = 100, cursor?: string): Promise<{ blocks: Block[], cursor?: string }> {
    const conditions = [eq(blocks.blockerDid, blockerDid)];
    
    if (cursor) {
      conditions.push(sql`${blocks.indexedAt} < ${cursor}`);
    }

    const results = await db
      .select()
      .from(blocks)
      .where(and(...conditions))
      .orderBy(desc(blocks.indexedAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;

    return { blocks: items, cursor: nextCursor };
  }

  async createMute(mute: InsertMute): Promise<Mute> {
    const [newMute] = await db
      .insert(mutes)
      .values(mute)
      .onConflictDoNothing()
      .returning();
    return newMute;
  }

  async deleteMute(uri: string): Promise<void> {
    await db.delete(mutes).where(eq(mutes.uri, uri));
  }

  async getMutes(muterDid: string, limit = 100, cursor?: string): Promise<{ mutes: Mute[], cursor?: string }> {
    const conditions = [eq(mutes.muterDid, muterDid)];
    
    if (cursor) {
      conditions.push(sql`${mutes.indexedAt} < ${cursor}`);
    }

    const results = await db
      .select()
      .from(mutes)
      .where(and(...conditions))
      .orderBy(desc(mutes.indexedAt))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;

    return { mutes: items, cursor: nextCursor };
  }

  async createListMute(listMute: InsertListMute): Promise<ListMute> {
    const [newListMute] = await db
      .insert(listMutes)
      .values(listMute)
      .onConflictDoNothing()
      .returning();
    return newListMute;
  }

  async deleteListMute(uri: string): Promise<void> {
    await db.delete(listMutes).where(eq(listMutes.uri, uri));
  }

  async getListMutes(muterDid: string, limit = 100, cursor?: string): Promise<{ mutes: ListMute[]; cursor?: string }> {
    let query = db
      .select()
      .from(listMutes)
      .where(eq(listMutes.muterDid, muterDid))
      .orderBy(desc(listMutes.createdAt))
      .limit(limit + 1);

    if (cursor) {
      const cursorDate = new Date(cursor);
      query = query.where(
        and(
          eq(listMutes.muterDid, muterDid),
          sql`${listMutes.createdAt} < ${cursorDate}`
        )
      ) as any;
    }

    const results = await query;
    const hasMore = results.length > limit;
    const mutes = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? mutes[mutes.length - 1].createdAt.toISOString() : undefined;

    return { mutes, cursor: nextCursor };
  }

  async createListBlock(listBlock: InsertListBlock): Promise<ListBlock> {
    const [newListBlock] = await db
      .insert(listBlocks)
      .values(listBlock)
      .onConflictDoNothing()
      .returning();
    return newListBlock;
  }

  async deleteListBlock(uri: string): Promise<void> {
    await db.delete(listBlocks).where(eq(listBlocks.uri, uri));
  }

  async getListBlocks(blockerDid: string, limit = 100, cursor?: string): Promise<{ blocks: ListBlock[]; cursor?: string }> {
    let query = db
      .select()
      .from(listBlocks)
      .where(eq(listBlocks.blockerDid, blockerDid))
      .orderBy(desc(listBlocks.createdAt))
      .limit(limit + 1);

    if (cursor) {
      const cursorDate = new Date(cursor);
      query = query.where(
        and(
          eq(listBlocks.blockerDid, blockerDid),
          sql`${listBlocks.createdAt} < ${cursorDate}`
        )
      ) as any;
    }

    const results = await query;
    const hasMore = results.length > limit;
    const blocks = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? blocks[blocks.length - 1].createdAt.toISOString() : undefined;

    return { blocks, cursor: nextCursor };
  }

  async getUserPreferences(userDid: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userDid, userDid));
    return prefs || undefined;
  }

  async createUserPreferences(prefs: InsertUserPreferences): Promise<UserPreferences> {
    const [newPrefs] = await db
      .insert(userPreferences)
      .values(prefs)
      .onConflictDoUpdate({
        target: userPreferences.userDid,
        set: prefs,
      })
      .returning();
    return newPrefs;
  }

  async updateUserPreferences(userDid: string, prefs: Partial<InsertUserPreferences>): Promise<UserPreferences | undefined> {
    const [updated] = await db
      .update(userPreferences)
      .set({ ...prefs, updatedAt: new Date() })
      .where(eq(userPreferences.userDid, userDid))
      .returning();
    return updated || undefined;
  }

  async getRelationships(viewerDid: string, targetDids: string[]): Promise<Map<string, {
    following: boolean;
    followedBy: boolean;
    blocking: boolean;
    blockedBy: boolean;
    muting: boolean;
  }>> {
    if (targetDids.length === 0) return new Map();

    const [followingList, followersList, blockingList, blockedByList, mutingList] = await Promise.all([
      db.select({ did: follows.followingDid })
        .from(follows)
        .where(and(
          eq(follows.followerDid, viewerDid),
          inArray(follows.followingDid, targetDids)
        )),
      db.select({ did: follows.followerDid })
        .from(follows)
        .where(and(
          eq(follows.followingDid, viewerDid),
          inArray(follows.followerDid, targetDids)
        )),
      db.select({ did: blocks.blockedDid })
        .from(blocks)
        .where(and(
          eq(blocks.blockerDid, viewerDid),
          inArray(blocks.blockedDid, targetDids)
        )),
      db.select({ did: blocks.blockerDid })
        .from(blocks)
        .where(and(
          eq(blocks.blockedDid, viewerDid),
          inArray(blocks.blockerDid, targetDids)
        )),
      db.select({ did: mutes.mutedDid })
        .from(mutes)
        .where(and(
          eq(mutes.muterDid, viewerDid),
          inArray(mutes.mutedDid, targetDids)
        )),
    ]);

    const followingSet = new Set(followingList.map(f => f.did));
    const followersSet = new Set(followersList.map(f => f.did));
    const blockingSet = new Set(blockingList.map(b => b.did));
    const blockedBySet = new Set(blockedByList.map(b => b.did));
    const mutingSet = new Set(mutingList.map(m => m.did));

    const relationships = new Map();
    for (const targetDid of targetDids) {
      relationships.set(targetDid, {
        following: followingSet.has(targetDid),
        followedBy: followersSet.has(targetDid),
        blocking: blockingSet.has(targetDid),
        blockedBy: blockedBySet.has(targetDid),
        muting: mutingSet.has(targetDid),
      });
    }

    return relationships;
  }

  async getTimeline(userDid: string, limit = 50, cursor?: string): Promise<Post[]> {
    const followList = await this.getFollows(userDid);
    const followingDids = followList.map(f => f.followingDid);
    
    if (followingDids.length === 0) {
      return [];
    }

    const conditions = [inArray(posts.authorDid, followingDids)];
    
    if (cursor) {
      conditions.push(sql`${posts.indexedAt} < ${cursor}`);
    }

    return await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.indexedAt))
      .limit(limit);
  }

  async createSession(session: InsertSession): Promise<Session> {
    // Encrypt tokens before storing
    const encryptedSession = {
      ...session,
      accessToken: encryptionService.encrypt(session.accessToken),
      refreshToken: session.refreshToken ? encryptionService.encrypt(session.refreshToken) : null,
    };
    
    const [newSession] = await db
      .insert(sessions)
      .values(encryptedSession)
      .returning();
    
    // Decrypt tokens before returning
    return {
      ...newSession,
      accessToken: encryptionService.decrypt(newSession.accessToken),
      refreshToken: newSession.refreshToken ? encryptionService.decrypt(newSession.refreshToken) : null,
    };
  }

  async getSession(id: string): Promise<Session | undefined> {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!session) return undefined;
    
    // Decrypt tokens before returning
    try {
      return {
        ...session,
        accessToken: encryptionService.decrypt(session.accessToken),
        refreshToken: session.refreshToken ? encryptionService.decrypt(session.refreshToken) : null,
      };
    } catch (error) {
      // Decryption failed (corrupted data) - delete the session
      console.error(`[STORAGE] Failed to decrypt session ${id}, deleting corrupted session`);
      await db.delete(sessions).where(eq(sessions.id, id));
      return undefined;
    }
  }

  async getUserSessions(userDid: string): Promise<Session[]> {
    const sessionList = await db.select().from(sessions).where(eq(sessions.userDid, userDid));
    
    // Decrypt tokens for each session, skipping corrupted ones
    const decryptedSessions: Session[] = [];
    for (const session of sessionList) {
      try {
        decryptedSessions.push({
          ...session,
          accessToken: encryptionService.decrypt(session.accessToken),
          refreshToken: session.refreshToken ? encryptionService.decrypt(session.refreshToken) : null,
        });
      } catch (error) {
        // Decryption failed - delete corrupted session
        console.error(`[STORAGE] Failed to decrypt session ${session.id}, deleting corrupted session`);
        await db.delete(sessions).where(eq(sessions.id, session.id));
      }
    }
    return decryptedSessions;
  }

  async updateSession(
    id: string, 
    data: Partial<Pick<InsertSession, 'accessToken' | 'refreshToken' | 'expiresAt'>>
  ): Promise<Session | undefined> {
    // Encrypt tokens if provided
    const updateData: any = {};
    if (data.accessToken) {
      updateData.accessToken = encryptionService.encrypt(data.accessToken);
    }
    if (data.refreshToken !== undefined) {
      updateData.refreshToken = data.refreshToken ? encryptionService.encrypt(data.refreshToken) : null;
    }
    if (data.expiresAt) {
      updateData.expiresAt = data.expiresAt;
    }

    const [updatedSession] = await db
      .update(sessions)
      .set(updateData)
      .where(eq(sessions.id, id))
      .returning();

    if (!updatedSession) return undefined;

    // Decrypt tokens before returning
    return {
      ...updatedSession,
      accessToken: encryptionService.decrypt(updatedSession.accessToken),
      refreshToken: updatedSession.refreshToken ? encryptionService.decrypt(updatedSession.refreshToken) : null,
    };
  }

  async deleteSession(id: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteExpiredSessions(): Promise<void> {
    await db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
  }

  async getUserSettings(userDid: string): Promise<UserSettings | undefined> {
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userDid, userDid));
    return settings || undefined;
  }

  async createUserSettings(settings: InsertUserSettings): Promise<UserSettings> {
    const [newSettings] = await db
      .insert(userSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: userSettings.userDid,
        set: settings,
      })
      .returning();
    return newSettings;
  }

  async updateUserSettings(userDid: string, settings: Partial<InsertUserSettings>): Promise<UserSettings | undefined> {
    const [updated] = await db
      .update(userSettings)
      .set(settings)
      .where(eq(userSettings.userDid, userDid))
      .returning();
    return updated || undefined;
  }

  // Label operations
  async createLabel(label: InsertLabel): Promise<Label> {
    const [newLabel] = await db
      .insert(labels)
      .values(label)
      .onConflictDoNothing()
      .returning();
    return newLabel;
  }

  async getLabel(uri: string): Promise<Label | undefined> {
    const [label] = await db.select().from(labels).where(eq(labels.uri, uri));
    return label || undefined;
  }

  async getLabelsForSubject(subject: string): Promise<Label[]> {
    return await db.select().from(labels).where(eq(labels.subject, subject));
  }

  async getLabelsForSubjects(subjects: string[]): Promise<Label[]> {
    if (subjects.length === 0) return [];
    return await db.select().from(labels).where(inArray(labels.subject, subjects));
  }

  async deleteLabel(uri: string): Promise<void> {
    await db.delete(labels).where(eq(labels.uri, uri));
  }

  async queryLabels(params: { sources?: string[], subjects?: string[], values?: string[], limit?: number }): Promise<Label[]> {
    const conditions = [];
    
    if (params.sources && params.sources.length > 0) {
      conditions.push(inArray(labels.src, params.sources));
    }
    if (params.subjects && params.subjects.length > 0) {
      conditions.push(inArray(labels.subject, params.subjects));
    }
    if (params.values && params.values.length > 0) {
      conditions.push(inArray(labels.val, params.values));
    }

    let query = db.select().from(labels);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    query = query.orderBy(desc(labels.createdAt)) as any;

    if (params.limit) {
      query = query.limit(params.limit) as any;
    }

    return await query;
  }

  // Label definition operations
  async createLabelDefinition(definition: InsertLabelDefinition): Promise<LabelDefinition> {
    const [newDef] = await db
      .insert(labelDefinitions)
      .values(definition)
      .onConflictDoUpdate({
        target: labelDefinitions.value,
        set: definition,
      })
      .returning();
    return newDef;
  }

  async getLabelDefinition(value: string): Promise<LabelDefinition | undefined> {
    const [def] = await db.select().from(labelDefinitions).where(eq(labelDefinitions.value, value));
    return def || undefined;
  }

  async getAllLabelDefinitions(): Promise<LabelDefinition[]> {
    return await db.select().from(labelDefinitions).orderBy(labelDefinitions.value);
  }

  async updateLabelDefinition(value: string, data: Partial<InsertLabelDefinition>): Promise<LabelDefinition | undefined> {
    const [updated] = await db
      .update(labelDefinitions)
      .set(data)
      .where(eq(labelDefinitions.value, value))
      .returning();
    return updated || undefined;
  }

  // Label event operations
  async createLabelEvent(event: InsertLabelEvent): Promise<LabelEvent> {
    const [newEvent] = await db
      .insert(labelEvents)
      .values(event)
      .returning();
    return newEvent;
  }

  async getRecentLabelEvents(limit = 100, since?: Date): Promise<LabelEvent[]> {
    let query = db.select().from(labelEvents);
    
    if (since) {
      query = query.where(sql`${labelEvents.createdAt} > ${since}`) as any;
    }

    return await query.orderBy(desc(labelEvents.createdAt)).limit(limit);
  }

  // Moderation report operations
  async createModerationReport(report: InsertModerationReport): Promise<ModerationReport> {
    const [newReport] = await db
      .insert(moderationReports)
      .values(report)
      .returning();
    return newReport;
  }

  async getModerationReport(id: number): Promise<ModerationReport | undefined> {
    const [report] = await db.select().from(moderationReports).where(eq(moderationReports.id, id));
    return report || undefined;
  }

  async getModerationReportsByStatus(status: string, limit = 100): Promise<ModerationReport[]> {
    return await db
      .select()
      .from(moderationReports)
      .where(eq(moderationReports.status, status))
      .orderBy(desc(moderationReports.createdAt))
      .limit(limit);
  }

  async getModerationReportsBySubject(subject: string): Promise<ModerationReport[]> {
    return await db
      .select()
      .from(moderationReports)
      .where(eq(moderationReports.subject, subject))
      .orderBy(desc(moderationReports.createdAt));
  }

  async getModerationReportsByReporter(reporterDid: string, limit = 100): Promise<ModerationReport[]> {
    return await db
      .select()
      .from(moderationReports)
      .where(eq(moderationReports.reporterDid, reporterDid))
      .orderBy(desc(moderationReports.createdAt))
      .limit(limit);
  }

  async updateModerationReportStatus(id: number, status: string): Promise<ModerationReport | undefined> {
    const [updated] = await db
      .update(moderationReports)
      .set({ status, updatedAt: new Date() })
      .where(eq(moderationReports.id, id))
      .returning();
    return updated || undefined;
  }

  // Moderation action operations
  async createModerationAction(action: InsertModerationAction): Promise<ModerationAction> {
    const [newAction] = await db
      .insert(moderationActions)
      .values(action)
      .returning();
    return newAction;
  }

  async getModerationActionsByReport(reportId: number): Promise<ModerationAction[]> {
    return await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.reportId, reportId))
      .orderBy(desc(moderationActions.createdAt));
  }

  async getModerationActionsByModerator(moderatorDid: string, limit = 100): Promise<ModerationAction[]> {
    return await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.moderatorDid, moderatorDid))
      .orderBy(desc(moderationActions.createdAt))
      .limit(limit);
  }

  // Moderator assignment operations
  async assignModerator(assignment: InsertModeratorAssignment): Promise<ModeratorAssignment> {
    const [newAssignment] = await db
      .insert(moderatorAssignments)
      .values(assignment)
      .returning();
    return newAssignment;
  }

  async getModeratorAssignmentsByReport(reportId: number): Promise<ModeratorAssignment[]> {
    return await db
      .select()
      .from(moderatorAssignments)
      .where(eq(moderatorAssignments.reportId, reportId))
      .orderBy(desc(moderatorAssignments.assignedAt));
  }

  async getModeratorAssignmentsByModerator(
    moderatorDid: string, 
    includeCompleted = false, 
    limit = 100
  ): Promise<ModeratorAssignment[]> {
    const conditions = [eq(moderatorAssignments.moderatorDid, moderatorDid)];

    if (!includeCompleted) {
      conditions.push(isNull(moderatorAssignments.completedAt));
    }

    return await db
      .select()
      .from(moderatorAssignments)
      .where(and(...conditions))
      .orderBy(desc(moderatorAssignments.assignedAt))
      .limit(limit);
  }

  async completeModeratorAssignment(id: number): Promise<ModeratorAssignment | undefined> {
    const [updated] = await db
      .update(moderatorAssignments)
      .set({ completedAt: new Date() })
      .where(eq(moderatorAssignments.id, id))
      .returning();
    return updated || undefined;
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db
      .insert(notifications)
      .values(notification)
      .onConflictDoNothing()
      .returning();
    return newNotification;
  }

  async getNotifications(recipientDid: string, limit = 50, cursor?: string): Promise<Notification[]> {
    const conditions = [eq(notifications.recipientDid, recipientDid)];

    if (cursor) {
      conditions.push(sql`${notifications.indexedAt} < ${new Date(cursor)}`);
    }

    return await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.indexedAt))
      .limit(limit);
  }

  async getUnreadNotificationCount(recipientDid: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(
        eq(notifications.recipientDid, recipientDid),
        eq(notifications.isRead, false)
      ));
    return Number(result[0]?.count || 0);
  }

  async markNotificationsAsRead(recipientDid: string, seenAt?: Date): Promise<void> {
    const conditions = [
      eq(notifications.recipientDid, recipientDid),
      eq(notifications.isRead, false)
    ];

    if (seenAt) {
      conditions.push(sql`${notifications.indexedAt} <= ${seenAt}`);
    }

    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(...conditions));
  }

  async createList(list: InsertList): Promise<List> {
    const [newList] = await db
      .insert(lists)
      .values(list)
      .returning();
    return newList;
  }

  async deleteList(uri: string): Promise<void> {
    await db.delete(lists).where(eq(lists.uri, uri));
  }

  async getList(uri: string): Promise<List | undefined> {
    const [list] = await db.select().from(lists).where(eq(lists.uri, uri));
    return list || undefined;
  }

  async getUserLists(creatorDid: string, limit = 50): Promise<List[]> {
    return await db
      .select()
      .from(lists)
      .where(eq(lists.creatorDid, creatorDid))
      .orderBy(desc(lists.indexedAt))
      .limit(limit);
  }

  async createListItem(item: InsertListItem): Promise<ListItem> {
    const [newItem] = await db
      .insert(listItems)
      .values(item)
      .onConflictDoNothing()
      .returning();
    return newItem;
  }

  async deleteListItem(uri: string): Promise<void> {
    await db.delete(listItems).where(eq(listItems.uri, uri));
  }

  async getListItems(listUri: string, limit = 100): Promise<ListItem[]> {
    return await db
      .select()
      .from(listItems)
      .where(eq(listItems.listUri, listUri))
      .orderBy(desc(listItems.indexedAt))
      .limit(limit);
  }

  async getListFeed(listUri: string, limit = 50, cursor?: string): Promise<Post[]> {
    const items = await this.getListItems(listUri, 500);
    const memberDids = items.map(item => item.subjectDid);

    if (memberDids.length === 0) {
      return [];
    }

    const conditions = [inArray(posts.authorDid, memberDids)];

    if (cursor) {
      conditions.push(sql`${posts.indexedAt} < ${new Date(cursor)}`);
    }

    return await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.indexedAt))
      .limit(limit);
  }

  private statsCache: { data: any, timestamp: number } | null = null;
  private readonly STATS_CACHE_TTL = 30000; // 30 seconds

  async getStats() {
    // Return cached stats if still valid
    if (this.statsCache && (Date.now() - this.statsCache.timestamp) < this.STATS_CACHE_TTL) {
      return this.statsCache.data;
    }

    try {
      // Set statement timeout to 2 seconds
      await pool.query('SET LOCAL statement_timeout = 2000');
      
      const result = await pool.query(`
        SELECT 
          schemaname,
          relname,
          n_live_tup as count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
          AND relname IN ('users', 'posts', 'likes', 'reposts', 'follows', 'blocks')
      `);

      const stats: Record<string, number> = {};
      result.rows.forEach((row: any) => {
        stats[row.relname] = Number(row.count || 0);
      });
      
      const data = {
        totalUsers: stats.users || 0,
        totalPosts: stats.posts || 0,
        totalLikes: stats.likes || 0,
        totalReposts: stats.reposts || 0,
        totalFollows: stats.follows || 0,
        totalBlocks: stats.blocks || 0,
      };

      // Cache the result
      this.statsCache = { data, timestamp: Date.now() };
      
      return data;
    } catch (error) {
      // If query times out or fails, return cached data if available, otherwise zeros
      if (this.statsCache) {
        return this.statsCache.data;
      }
      
      return {
        totalUsers: 0,
        totalPosts: 0,
        totalLikes: 0,
        totalReposts: 0,
        totalFollows: 0,
        totalBlocks: 0,
      };
    }
  }
}

export const storage = new DatabaseStorage();
