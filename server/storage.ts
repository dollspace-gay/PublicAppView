import { users, posts, likes, reposts, bookmarks, follows, blocks, mutes, listMutes, listBlocks, threadMutes, userPreferences, sessions, userSettings, labels, labelDefinitions, labelEvents, moderationReports, moderationActions, moderatorAssignments, notifications, lists, listItems, feedGenerators, starterPacks, labelerServices, pushSubscriptions, videoJobs, firehoseCursor, feedItems, postAggregations, postViewerStates, threadContexts, type User, type InsertUser, type Post, type InsertPost, type Like, type InsertLike, type Repost, type InsertRepost, type Follow, type InsertFollow, type Block, type InsertBlock, type Mute, type InsertMute, type ListMute, type InsertListMute, type ListBlock, type InsertListBlock, type ThreadMute, type InsertThreadMute, type UserPreferences, type InsertUserPreferences, type Session, type InsertSession, type UserSettings, type InsertUserSettings, type Label, type InsertLabel, type LabelDefinition, type InsertLabelDefinition, type LabelEvent, type InsertLabelEvent, type ModerationReport, type InsertModerationReport, type ModerationAction, type InsertModerationAction, type ModeratorAssignment, type InsertModeratorAssignment, type Notification, type InsertNotification, type List, type InsertList, type ListItem, type InsertListItem, type FeedGenerator, type InsertFeedGenerator, type StarterPack, type InsertStarterPack, type LabelerService, type InsertLabelerService, type PushSubscription, type InsertPushSubscription, type VideoJob, type InsertVideoJob, type FirehoseCursor, type InsertFirehoseCursor, type Bookmark, insertBookmarkSchema, type FeedItem, type InsertFeedItem, type PostAggregation, type InsertPostAggregation, type PostViewerState, type InsertPostViewerState, type ThreadContext, type InsertThreadContext } from "@shared/schema";
import { db, pool, type DbConnection } from "./db";
import { eq, desc, and, sql, inArray, isNull } from "drizzle-orm";
import { encryptionService } from "./services/encryption";
import { sanitizeObject } from "./utils/sanitize";

export interface IStorage {
  // User operations
  getUser(did: string): Promise<User | undefined>;
  getUsers(dids: string[]): Promise<User[]>;
  getUserByHandle(handle: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(did: string, data: Partial<InsertUser>): Promise<User | undefined>;
  upsertUserHandle(did: string, handle: string): Promise<void>;
  getSuggestedUsers(viewerDid?: string, limit?: number): Promise<User[]>;
  getUserFollowerCount(did: string): Promise<number>;
  getUsersFollowerCounts(dids: string[]): Promise<Map<string, number>>;
  getUserFollowingCount(did: string): Promise<number>;
  getUsersFollowingCounts(dids: string[]): Promise<Map<string, number>>;
  getUserPostCount(did: string): Promise<number>;
  getUsersPostCounts(dids: string[]): Promise<Map<string, number>>;
  getUserListCount(did: string): Promise<number>;
  getUsersListCounts(dids: string[]): Promise<Map<string, number>>;
  getUserFeedGeneratorCount(did: string): Promise<number>;
  getUsersFeedGeneratorCounts(dids: string[]): Promise<Map<string, number>>;
  getUserProfileRecord(did: string): Promise<any | undefined>;

  // Post operations
  getPost(uri: string): Promise<Post | undefined>;
  getPosts(uris: string[]): Promise<Post[]>;
  createPost(post: InsertPost): Promise<Post>;
  deletePost(uri: string): Promise<void>;
  getAuthorPosts(authorDid: string, limit?: number, cursor?: string): Promise<Post[]>;
  getPostThread(uri: string): Promise<Post[]>;
  getQuotePosts(postUri: string, limit?: number, cursor?: string): Promise<Post[]>;

  // Feed operations
  getAuthorFeed(actorDid: string, limit?: number, cursor?: string, feedType?: string): Promise<{ items: FeedItem[], cursor?: string }>;
  createFeedItem(feedItem: InsertFeedItem): Promise<FeedItem>;
  deleteFeedItem(uri: string): Promise<void>;

  // Like operations
  createLike(like: InsertLike): Promise<Like>;
  deleteLike(uri: string): Promise<void>;
  getLike(uri: string): Promise<Like | undefined>;
  getPostLikes(postUri: string, limit?: number, cursor?: string): Promise<{ likes: Like[], cursor?: string }>;
  getActorLikes(userDid: string, limit?: number, cursor?: string): Promise<{ likes: Like[], cursor?: string }>;
  getLikeUri(userDid: string, postUri: string): Promise<string | undefined>;
  getLikeUris(userDid: string, postUris: string[]): Promise<Map<string, string>>;

  // Repost operations
  createRepost(repost: InsertRepost): Promise<Repost>;
  deleteRepost(uri: string): Promise<void>;
  getRepost(uri: string): Promise<Repost | undefined>;
  getPostReposts(postUri: string, limit?: number, cursor?: string): Promise<{ reposts: Repost[], cursor?: string }>;
  getRepostUri(userDid: string, postUri: string): Promise<string | undefined>;
  getRepostUris(userDid: string, postUris: string[]): Promise<Map<string, string>>;

  // Bookmark operations
  createBookmark(bookmark: { uri: string; userDid: string; postUri: string; createdAt: Date }): Promise<Bookmark>;
  deleteBookmark(uri: string): Promise<void>;
  getBookmarks(userDid: string, limit?: number, cursor?: string): Promise<{ bookmarks: Bookmark[], cursor?: string }>;
  getBookmarkUri(userDid: string, postUri: string): Promise<string | undefined>;

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
  getBlocksBetweenUsers(blockerDid: string, targetDids: string[]): Promise<Block[]>;
  
  // Mute operations
  createMute(mute: InsertMute): Promise<Mute>;
  deleteMute(uri: string): Promise<void>;
  getMutes(muterDid: string, limit?: number, cursor?: string): Promise<{ mutes: Mute[], cursor?: string }>;
  findMutingListForUser(viewerDid: string, targetDid: string): Promise<List | null>;
  findMutingListsForUsers(
    viewerDid: string,
    targetDids: string[],
  ): Promise<Map<string, List>>;
  
  // List mute operations
  createListMute(listMute: InsertListMute): Promise<ListMute>;
  deleteListMute(uri: string): Promise<void>;
  getListMutes(muterDid: string, limit?: number, cursor?: string): Promise<{ mutes: ListMute[], cursor?: string }>;
  
  // List block operations
  createListBlock(listBlock: InsertListBlock): Promise<ListBlock>;
  deleteListBlock(uri: string): Promise<void>;
  getListBlocks(blockerDid: string, limit?: number, cursor?: string): Promise<{ blocks: ListBlock[], cursor?: string }>;
  
  // Thread mute operations
  createThreadMute(threadMute: InsertThreadMute): Promise<ThreadMute>;
  deleteThreadMute(uri: string): Promise<void>;
  getThreadMutes(muterDid: string, limit?: number, cursor?: string): Promise<{ mutes: ThreadMute[], cursor?: string }>;
  isThreadMuted(muterDid: string, threadRootUri: string): Promise<boolean>;
  
  // User preferences operations
  createUserPreferences(prefs: InsertUserPreferences): Promise<UserPreferences>;
  updateUserPreferences(userDid: string, prefs: Partial<InsertUserPreferences>): Promise<UserPreferences | undefined>;
  
  // Relationship operations
  getRelationships(viewerDid: string, targetDids: string[]): Promise<Map<string, {
    following: string | undefined;
    followedBy: string | undefined;
    blocking: string | undefined;
    blockedBy: boolean;
    muting: boolean;
  }>>;
  getKnownFollowers(actorDid: string, viewerDid: string, limit?: number, cursor?: string): Promise<{ followers: User[], cursor?: string, count: number }>;
  getSuggestedFollowsByActor(actorDid: string, limit?: number): Promise<User[]>;

  // Session operations
  createSession(session: InsertSession): Promise<Session>;
  getSession(id: string): Promise<Session | undefined>;
  getUserSessions(userDid: string): Promise<Session[]>;
  updateSession(id: string, data: Partial<Pick<InsertSession, 'accessToken' | 'refreshToken' | 'expiresAt'>>): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;

  // OAuth state operations
  saveOAuthState(state: string, stateData: any, expiresAt: Date): Promise<void>;
  getOAuthState(state: string): Promise<any | undefined>;
  deleteOAuthState(state: string): Promise<void>;
  deleteExpiredOAuthStates(): Promise<void>;

  // User settings operations
  getUserSettings(userDid: string): Promise<UserSettings | undefined>;
  createUserSettings(settings: InsertUserSettings): Promise<UserSettings>;
  updateUserSettings(userDid: string, settings: Partial<InsertUserSettings>): Promise<UserSettings | undefined>;
  deleteUserData(userDid: string): Promise<void>;

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
  
  // Feed generator operations
  createFeedGenerator(generator: InsertFeedGenerator): Promise<FeedGenerator>;
  deleteFeedGenerator(uri: string): Promise<void>;
  getFeedGenerator(uri: string): Promise<FeedGenerator | undefined>;
  getFeedGenerators(uris: string[]): Promise<FeedGenerator[]>;
  getActorFeeds(actorDid: string, limit?: number, cursor?: string): Promise<{ generators: FeedGenerator[], cursor?: string }>;
  getSuggestedFeeds(limit?: number, cursor?: string): Promise<{ generators: FeedGenerator[], cursor?: string }>;
  updateFeedGenerator(uri: string, data: Partial<InsertFeedGenerator>): Promise<FeedGenerator | undefined>;
  
  // Starter pack operations
  createStarterPack(pack: InsertStarterPack): Promise<StarterPack>;
  deleteStarterPack(uri: string): Promise<void>;
  getStarterPack(uri: string): Promise<StarterPack | undefined>;
  getStarterPacks(uris: string[]): Promise<StarterPack[]>;
  listStarterPacks(limit?: number, cursor?: string): Promise<{ starterPacks: StarterPack[]; cursor?: string }>;
  getStarterPacksByCreator(creatorDid: string, limit?: number, cursor?: string): Promise<{ starterPacks: StarterPack[]; cursor?: string }>;
  searchStarterPacksByName(q: string, limit?: number, cursor?: string): Promise<{ starterPacks: StarterPack[]; cursor?: string }>;
  
  // Labeler service operations
  createLabelerService(service: InsertLabelerService): Promise<LabelerService>;
  deleteLabelerService(uri: string): Promise<void>;
  getLabelerService(uri: string): Promise<LabelerService | undefined>;
  getLabelerServices(uris: string[]): Promise<LabelerService[]>;
  getLabelerServicesByCreator(creatorDid: string): Promise<LabelerService[]>;
  updateLabelerService(uri: string, data: Partial<InsertLabelerService>): Promise<LabelerService | undefined>;
  
  // Push subscription operations
  createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(id: number): Promise<void>;
  deletePushSubscriptionByToken(token: string): Promise<void>;
  getUserPushSubscriptions(userDid: string): Promise<PushSubscription[]>;
  getPushSubscription(id: number): Promise<PushSubscription | undefined>;
  updatePushSubscription(id: number, data: Partial<InsertPushSubscription>): Promise<PushSubscription | undefined>;
  
  // Video job operations
  createVideoJob(job: InsertVideoJob): Promise<VideoJob>;
  getVideoJob(jobId: string): Promise<VideoJob | undefined>;
  getUserVideoJobs(userDid: string, limit?: number): Promise<VideoJob[]>;
  updateVideoJob(jobId: string, data: Partial<InsertVideoJob>): Promise<VideoJob | undefined>;
  deleteVideoJob(jobId: string): Promise<void>;
  
  // Firehose cursor operations
  getFirehoseCursor(service: string): Promise<FirehoseCursor | undefined>;
  saveFirehoseCursor(service: string, cursor: string | null, lastEventTime?: Date): Promise<void>;
  
  // Backfill progress operations
  getBackfillProgress(): Promise<{ currentCursor: string | null; eventsProcessed: number; lastUpdateTime: Date } | undefined>;
  saveBackfillProgress(progress: { currentCursor: string | null; eventsProcessed: number; lastUpdateTime: Date }): Promise<void>;
  
  // Stats
  getStats(): Promise<{
    totalUsers: number;
    totalPosts: number;
    totalLikes: number;
    totalReposts: number;
    totalFollows: number;
    totalBlocks: number;
  }>;

  // Post aggregations operations
  createPostAggregation(aggregation: InsertPostAggregation): Promise<PostAggregation>;
  getPostAggregation(postUri: string): Promise<PostAggregation | undefined>;
  getPostAggregations(postUris: string[]): Promise<Map<string, PostAggregation>>;
  incrementPostAggregation(postUri: string, field: 'likeCount' | 'repostCount' | 'replyCount' | 'bookmarkCount' | 'quoteCount', delta: number): Promise<void>;
  updatePostAggregation(postUri: string, data: Partial<InsertPostAggregation>): Promise<void>;

  // Post viewer states operations
  createPostViewerState(viewerState: InsertPostViewerState): Promise<PostViewerState>;
  getPostViewerState(postUri: string, viewerDid: string): Promise<PostViewerState | undefined>;
  getPostViewerStates(postUris: string[], viewerDid: string): Promise<Map<string, PostViewerState>>;
  updatePostViewerState(postUri: string, viewerDid: string, data: Partial<InsertPostViewerState>): Promise<void>;
  deletePostViewerState(postUri: string, viewerDid: string): Promise<void>;

  // Thread context operations
  createThreadContext(context: InsertThreadContext): Promise<ThreadContext>;
  getThreadContext(postUri: string): Promise<ThreadContext | undefined>;
  getThreadContexts(postUris: string[]): Promise<Map<string, ThreadContext>>;
  updateThreadContext(postUri: string, data: Partial<InsertThreadContext>): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private db: DbConnection;
  private statsCache: { data: any, timestamp: number } | null = null;
  private readonly STATS_CACHE_TTL = 60000;
  private statsQueryInProgress = false;
  private backgroundRefreshInterval: NodeJS.Timeout | null = null;

  constructor(dbConnection?: DbConnection) {
    this.db = dbConnection || db;
    
    // Start background refresh every 30 seconds to keep cache warm
    this.backgroundRefreshInterval = setInterval(() => {
      this.refreshStatsInBackground();
    }, 30000);
  }

  async getUser(did: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.did, did));
    return user || undefined;
  }

  async getUserByHandle(handle: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.handle, handle));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const sanitized = sanitizeObject(insertUser);
    
    // Check if user already exists to determine if this is a new user
    const existingUser = await this.getUser(sanitized.did);
    const isNewUser = !existingUser;
    
    const [user] = await this.db
      .insert(users)
      .values(sanitized)
      .onConflictDoUpdate({
        target: users.did,
        set: {
          handle: sanitized.handle,
          displayName: sanitized.displayName,
          avatarUrl: sanitized.avatarUrl,
          description: sanitized.description,
          profileRecord: sanitized.profileRecord,
        },
      })
      .returning();
    
    // Update Redis counter for dashboard metrics (only if this was a new user)
    if (isNewUser) {
      const { redisQueue } = await import("./services/redis-queue");
      await redisQueue.incrementRecordCount('users');
    }
    
    return user;
  }

  async updateUser(did: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const sanitized = sanitizeObject(data);
    const [user] = await db
      .update(users)
      .set(sanitized)
      .where(eq(users.did, did))
      .returning();
    return user || undefined;
  }

  async upsertUserHandle(did: string, handle: string): Promise<void> {
    // Check if user already exists to determine if this is a new user
    const existingUser = await this.getUser(did);
    const isNewUser = !existingUser;
    
    await this.db
      .insert(users)
      .values({ did, handle })
      .onConflictDoUpdate({
        target: users.did,
        set: { handle },
      });
    
    // Update Redis counter for dashboard metrics (only if this was a new user)
    if (isNewUser) {
      const { redisQueue } = await import("./services/redis-queue");
      await redisQueue.incrementRecordCount('users');
    }
  }

  async getUsers(dids: string[]): Promise<User[]> {
    if (dids.length === 0) return [];
    return await this.db.select().from(users).where(inArray(users.did, dids));
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

  async getUserFollowerCount(did: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followingDid, did));
    return result.count;
  }

  async getUsersFollowerCounts(dids: string[]): Promise<Map<string, number>> {
    if (dids.length === 0) return new Map();
    const results = await this.db
      .select({
        did: follows.followingDid,
        count: sql<number>`count(*)::int`,
      })
      .from(follows)
      .where(inArray(follows.followingDid, dids))
      .groupBy(follows.followingDid);
    return new Map(results.map((r) => [r.did, r.count]));
  }

  async getUserFollowingCount(did: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followerDid, did));
    return result.count;
  }

  async getUsersFollowingCounts(dids: string[]): Promise<Map<string, number>> {
    if (dids.length === 0) return new Map();
    const results = await this.db
      .select({
        did: follows.followerDid,
        count: sql<number>`count(*)::int`,
      })
      .from(follows)
      .where(inArray(follows.followerDid, dids))
      .groupBy(follows.followerDid);
    return new Map(results.map((r) => [r.did, r.count]));
  }

  async getUserPostCount(did: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(eq(posts.authorDid, did));
    return result.count;
  }

  async getUsersPostCounts(dids: string[]): Promise<Map<string, number>> {
    if (dids.length === 0) return new Map();
    const results = await this.db
      .select({
        did: posts.authorDid,
        count: sql<number>`count(*)::int`,
      })
      .from(posts)
      .where(inArray(posts.authorDid, dids))
      .groupBy(posts.authorDid);
    return new Map(results.map((r) => [r.did, r.count]));
  }

  async getUserListCount(did: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(lists)
      .where(eq(lists.creatorDid, did));
    return result.count;
  }

  async getUsersListCounts(dids: string[]): Promise<Map<string, number>> {
    if (dids.length === 0) return new Map();
    const results = await this.db
      .select({
        did: lists.creatorDid,
        count: sql<number>`count(*)::int`,
      })
      .from(lists)
      .where(inArray(lists.creatorDid, dids))
      .groupBy(lists.creatorDid);
    return new Map(results.map((r) => [r.did, r.count]));
  }

  async getUserFeedGeneratorCount(did: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedGenerators)
      .where(eq(feedGenerators.creatorDid, did));
    return result.count;
  }

  async getUsersFeedGeneratorCounts(
    dids: string[],
  ): Promise<Map<string, number>> {
    if (dids.length === 0) return new Map();
    const results = await this.db
      .select({
        did: feedGenerators.creatorDid,
        count: sql<number>`count(*)::int`,
      })
      .from(feedGenerators)
      .where(inArray(feedGenerators.creatorDid, dids))
      .groupBy(feedGenerators.creatorDid);
    return new Map(results.map((r) => [r.did, r.count]));
  }

  async getUserProfileRecord(did: string): Promise<any | undefined> {
    const [user] = await this.db
      .select({ profileRecord: users.profileRecord })
      .from(users)
      .where(eq(users.did, did))
      .limit(1);

    return user ? user.profileRecord : undefined;
  }

  async findMutingListForUser(viewerDid: string, targetDid: string): Promise<List | null> {
    const mutedLists = await this.db.select({ listUri: listMutes.listUri })
      .from(listMutes)
      .where(eq(listMutes.muterDid, viewerDid));

    if (mutedLists.length === 0) return null;

    const listUris = mutedLists.map(l => l.listUri);

    const [listItemRecord] = await this.db.select({ listUri: listItems.listUri })
      .from(listItems)
      .where(and(
        eq(listItems.subjectDid, targetDid),
        inArray(listItems.listUri, listUris)
      ))
      .limit(1);

    if (!listItemRecord) return null;

    const list = await this.getList(listItemRecord.listUri);
    return list || null;
  }

  async findMutingListsForUsers(
    viewerDid: string,
    targetDids: string[],
  ): Promise<Map<string, List>> {
    if (targetDids.length === 0) {
      return new Map();
    }

    const mutedListRecords = await this.db
      .select({ listUri: listMutes.listUri })
      .from(listMutes)
      .where(eq(listMutes.muterDid, viewerDid));

    if (mutedListRecords.length === 0) {
      return new Map();
    }

    const mutedListUris = mutedListRecords.map((l) => l.listUri);

    const listMembership = await this.db
      .select({
        listUri: listItems.listUri,
        subjectDid: listItems.subjectDid,
      })
      .from(listItems)
      .where(
        and(
          inArray(listItems.subjectDid, targetDids),
          inArray(listItems.listUri, mutedListUris),
        ),
      );

    if (listMembership.length === 0) {
      return new Map();
    }

    // A user could be in multiple muted lists. We only need to return one.
    const userToListUri = new Map<string, string>();
    for (const item of listMembership) {
      if (!userToListUri.has(item.subjectDid)) {
        userToListUri.set(item.subjectDid, item.listUri);
      }
    }

    const listsToFetch = Array.from(new Set(userToListUri.values()));
    const fetchedLists = await this.db
      .select()
      .from(lists)
      .where(inArray(lists.uri, listsToFetch));

    const listsByUri = new Map(fetchedLists.map((l) => [l.uri, l]));
    const result = new Map<string, List>();

    userToListUri.forEach((listUri, did) => {
      const list = listsByUri.get(listUri);
      if (list) {
        result.set(did, list);
      }
    });

    return result;
  }

  async getPost(uri: string): Promise<Post | undefined> {
    const [post] = await this.db.select().from(posts).where(eq(posts.uri, uri));
    return post || undefined;
  }

  async createPost(post: InsertPost): Promise<Post> {
    const sanitized = sanitizeObject(post);
    const [newPost] = await this.db
      .insert(posts)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('posts');
    
    return newPost;
  }

  async deletePost(uri: string): Promise<void> {
    await this.db.delete(posts).where(eq(posts.uri, uri));
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('posts', -1);
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

  async getAuthorFeed(actorDid: string, limit = 50, cursor?: string, feedType?: string): Promise<{ items: FeedItem[], cursor?: string }> {
    let builder = db
      .select()
      .from(feedItems)
      .innerJoin(posts, eq(posts.uri, feedItems.postUri))
      .where(eq(feedItems.originatorDid, actorDid));

    // Apply feed type filtering
    if (feedType === 'posts_no_replies') {
      builder = builder.where(
        and(
          eq(feedItems.type, 'post'),
          isNull(posts.parentUri)
        ).or(eq(feedItems.type, 'repost'))
      );
    } else if (feedType === 'posts_with_media') {
      builder = builder
        .where(eq(feedItems.type, 'post'))
        .where(sql`${posts.embed} IS NOT NULL 
          AND ${posts.embed}->>'$type' IN ('app.bsky.embed.images', 'app.bsky.embed.external')`);
    } else if (feedType === 'posts_with_video') {
      builder = builder
        .where(eq(feedItems.type, 'post'))
        .where(sql`${posts.embed} IS NOT NULL 
          AND ${posts.embed}->>'$type' = 'app.bsky.embed.recordWithMedia'
          AND ${posts.embed}->'media'->>'$type' = 'app.bsky.embed.video'`);
    } else if (feedType === 'posts_and_author_threads') {
      builder = builder.where(
        eq(feedItems.type, 'repost')
          .or(eq(feedItems.type, 'post').and(isNull(posts.parentUri)))
          .or(sql`${posts.rootUri} LIKE ${`at://${actorDid}/%`}`)
      );
    }

    if (cursor) {
      builder = builder.where(sql`${feedItems.sortAt} < ${cursor}`);
    }

    const feedItemsData = await builder
      .orderBy(desc(feedItems.sortAt))
      .limit(limit)
      .execute();

    const items: FeedItem[] = feedItemsData.map((item) => ({
      post: { uri: item.feed_items.postUri, cid: item.feed_items.cid },
      repost: item.feed_items.type === 'repost' ? { uri: item.feed_items.uri, cid: item.feed_items.cid } : undefined,
    }));

    const nextCursor = feedItemsData.length > 0 
      ? feedItemsData[feedItemsData.length - 1].feed_items.sortAt.toISOString()
      : undefined;

    return { items, cursor: nextCursor };
  }

  async createFeedItem(feedItem: InsertFeedItem): Promise<FeedItem> {
    const [result] = await db.insert(feedItems).values(feedItem).returning();
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('feed_items');
    
    return result;
  }

  async deleteFeedItem(uri: string): Promise<void> {
    await db.delete(feedItems).where(eq(feedItems.uri, uri));
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('feed_items', -1);
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
    return await this.db.select().from(posts).where(inArray(posts.uri, uris));
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
    const sanitized = sanitizeObject(like);
    const [newLike] = await this.db
      .insert(likes)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('likes');
    
    return newLike;
  }

  async deleteLike(uri: string): Promise<void> {
    await this.db.delete(likes).where(eq(likes.uri, uri));
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('likes', -1);
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

  async getLikeUri(userDid: string, postUri: string): Promise<string | undefined> {
    const [like] = await this.db.select({ uri: likes.uri })
      .from(likes)
      .where(and(
        eq(likes.userDid, userDid),
        eq(likes.postUri, postUri)
      ))
      .limit(1);
    return like?.uri;
  }

  async getLikeUris(userDid: string, postUris: string[]): Promise<Map<string, string>> {
    if (postUris.length === 0) return new Map();
    const results = await this.db
      .select({ uri: likes.uri, postUri: likes.postUri })
      .from(likes)
      .where(and(eq(likes.userDid, userDid), inArray(likes.postUri, postUris)));
    return new Map(results.map((r) => [r.postUri, r.uri]));
  }

  async getLike(uri: string): Promise<Like | undefined> {
    const [result] = await this.db.select().from(likes).where(eq(likes.uri, uri));
    return result;
  }

  async createRepost(repost: InsertRepost): Promise<Repost> {
    const sanitized = sanitizeObject(repost);
    const [newRepost] = await this.db
      .insert(reposts)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('reposts');
    
    return newRepost;
  }

  async deleteRepost(uri: string): Promise<void> {
    await this.db.delete(reposts).where(eq(reposts.uri, uri));
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('reposts', -1);
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

  async getRepostUri(userDid: string, postUri: string): Promise<string | undefined> {
    const [repost] = await this.db.select({ uri: reposts.uri })
      .from(reposts)
      .where(and(
        eq(reposts.userDid, userDid),
        eq(reposts.postUri, postUri)
      ))
      .limit(1);
    return repost?.uri;
  }

  async getRepostUris(userDid: string, postUris: string[]): Promise<Map<string, string>> {
    if (postUris.length === 0) return new Map();
    const results = await this.db
      .select({ uri: reposts.uri, postUri: reposts.postUri })
      .from(reposts)
      .where(
        and(eq(reposts.userDid, userDid), inArray(reposts.postUri, postUris)),
      );
    return new Map(results.map((r) => [r.postUri, r.uri]));
  }

  async getRepost(uri: string): Promise<Repost | undefined> {
    const [result] = await this.db.select().from(reposts).where(eq(reposts.uri, uri));
    return result;
  }

  // Bookmark operations
  async createBookmark(bookmark: { uri: string; userDid: string; postUri: string; createdAt: Date }): Promise<Bookmark> {
    const [row] = await this.db
      .insert(bookmarks)
      .values({
        uri: bookmark.uri,
        userDid: bookmark.userDid,
        postUri: bookmark.postUri,
        createdAt: bookmark.createdAt,
      })
      .onConflictDoNothing()
      .returning();
    return row as Bookmark;
  }

  async deleteBookmark(uri: string): Promise<void> {
    await this.db.delete(bookmarks).where(eq(bookmarks.uri, uri));
  }

  async getBookmarks(userDid: string, limit = 50, cursor?: string): Promise<{ bookmarks: Bookmark[]; cursor?: string }> {
    const conditions = [eq(bookmarks.userDid, userDid)];
    if (cursor) {
      conditions.push(sql`${bookmarks.indexedAt} < ${new Date(cursor)}`);
    }
    const results = await this.db
      .select()
      .from(bookmarks)
      .where(and(...conditions))
      .orderBy(desc(bookmarks.indexedAt))
      .limit(limit + 1);
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;
    return { bookmarks: items as Bookmark[], cursor: nextCursor };
  }

  async getBookmarkUri(userDid: string, postUri: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ uri: bookmarks.uri })
      .from(bookmarks)
      .where(and(eq(bookmarks.userDid, userDid), eq(bookmarks.postUri, postUri)))
      .limit(1);
    return row?.uri;
  }

  async createFollow(follow: InsertFollow): Promise<Follow> {
    const sanitized = sanitizeObject(follow);
    const [newFollow] = await this.db
      .insert(follows)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('follows');
    
    return newFollow;
  }

  async deleteFollow(uri: string): Promise<void> {
    await this.db.delete(follows).where(eq(follows.uri, uri));
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('follows', -1);
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
    const sanitized = sanitizeObject(block);
    const [newBlock] = await this.db
      .insert(blocks)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('blocks');
    
    return newBlock;
  }

  async deleteBlock(uri: string): Promise<void> {
    await this.db.delete(blocks).where(eq(blocks.uri, uri));
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('blocks', -1);
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

  async getBlocksBetweenUsers(blockerDid: string, targetDids: string[]): Promise<Block[]> {
    if (targetDids.length === 0) return [];

    return await db
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.blockerDid, blockerDid),
          inArray(blocks.blockedDid, targetDids)
        )
      );
  }

  async createMute(mute: InsertMute): Promise<Mute> {
    const sanitized = sanitizeObject(mute);
    const [newMute] = await this.db
      .insert(mutes)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    return newMute;
  }

  async deleteMute(uri: string): Promise<void> {
    await this.db.delete(mutes).where(eq(mutes.uri, uri));
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
    const sanitized = sanitizeObject(listMute);
    const [newListMute] = await this.db
      .insert(listMutes)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    return newListMute;
  }

  async deleteListMute(uri: string): Promise<void> {
    await this.db.delete(listMutes).where(eq(listMutes.uri, uri));
  }

  async getListMutes(muterDid: string, limit = 100, cursor?: string): Promise<{ mutes: ListMute[]; cursor?: string }> {
    const conditions = [eq(listMutes.muterDid, muterDid)];
    
    if (cursor) {
      const cursorDate = new Date(cursor);
      conditions.push(sql`${listMutes.createdAt} < ${cursorDate}`);
    }

    const query = this.db
      .select()
      .from(listMutes)
      .where(and(...conditions))
      .orderBy(desc(listMutes.createdAt))
      .limit(limit + 1);

    const results = await query;
    const hasMore = results.length > limit;
    const mutes = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? mutes[mutes.length - 1].createdAt.toISOString() : undefined;

    return { mutes, cursor: nextCursor };
  }

  async createListBlock(listBlock: InsertListBlock): Promise<ListBlock> {
    const sanitized = sanitizeObject(listBlock);
    const [newListBlock] = await this.db
      .insert(listBlocks)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    return newListBlock;
  }

  async deleteListBlock(uri: string): Promise<void> {
    await this.db.delete(listBlocks).where(eq(listBlocks.uri, uri));
  }

  async getListBlocks(blockerDid: string, limit = 100, cursor?: string): Promise<{ blocks: ListBlock[]; cursor?: string }> {
    const conditions = [eq(listBlocks.blockerDid, blockerDid)];
    
    if (cursor) {
      const cursorDate = new Date(cursor);
      conditions.push(sql`${listBlocks.createdAt} < ${cursorDate}`);
    }

    const query = this.db
      .select()
      .from(listBlocks)
      .where(and(...conditions))
      .orderBy(desc(listBlocks.createdAt))
      .limit(limit + 1);

    const results = await query;
    const hasMore = results.length > limit;
    const blocks = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? blocks[blocks.length - 1].createdAt.toISOString() : undefined;

    return { blocks, cursor: nextCursor };
  }

  async createThreadMute(threadMute: InsertThreadMute): Promise<ThreadMute> {
    const sanitized = sanitizeObject(threadMute);
    const [newThreadMute] = await this.db
      .insert(threadMutes)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    return newThreadMute;
  }

  async deleteThreadMute(uri: string): Promise<void> {
    await this.db.delete(threadMutes).where(eq(threadMutes.uri, uri));
  }

  async getThreadMutes(muterDid: string, limit = 100, cursor?: string): Promise<{ mutes: ThreadMute[]; cursor?: string }> {
    const conditions = [eq(threadMutes.muterDid, muterDid)];
    
    if (cursor) {
      const cursorDate = new Date(cursor);
      conditions.push(sql`${threadMutes.createdAt} < ${cursorDate}`);
    }

    const query = this.db
      .select()
      .from(threadMutes)
      .where(and(...conditions))
      .orderBy(desc(threadMutes.createdAt))
      .limit(limit + 1);

    const results = await query;
    const hasMore = results.length > limit;
    const mutes = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? mutes[mutes.length - 1].createdAt.toISOString() : undefined;

    return { mutes, cursor: nextCursor };
  }

  async isThreadMuted(muterDid: string, threadRootUri: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(threadMutes)
      .where(and(eq(threadMutes.muterDid, muterDid), eq(threadMutes.threadRootUri, threadRootUri)))
      .limit(1);
    return !!result;
  }


  async createUserPreferences(prefs: InsertUserPreferences): Promise<UserPreferences> {
    const sanitized = sanitizeObject(prefs);
    const [newPrefs] = await this.db
      .insert(userPreferences)
      .values(sanitized)
      .onConflictDoUpdate({
        target: userPreferences.userDid,
        set: sanitized,
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
    following: string | undefined;
    followedBy: string | undefined;
    blocking: string | undefined;
    blockedBy: boolean;
    muting: boolean;
  }>> {
    if (targetDids.length === 0) return new Map();

    const [followingList, followersList, blockingList, blockedByList, mutingList] = await Promise.all([
      this.db.select({ did: follows.followingDid, uri: follows.uri })
        .from(follows)
        .where(and(
          eq(follows.followerDid, viewerDid),
          inArray(follows.followingDid, targetDids)
        )),
      this.db.select({ did: follows.followerDid, uri: follows.uri })
        .from(follows)
        .where(and(
          eq(follows.followingDid, viewerDid),
          inArray(follows.followerDid, targetDids)
        )),
      this.db.select({ did: blocks.blockedDid, uri: blocks.uri })
        .from(blocks)
        .where(and(
          eq(blocks.blockerDid, viewerDid),
          inArray(blocks.blockedDid, targetDids)
        )),
      this.db.select({ did: blocks.blockerDid })
        .from(blocks)
        .where(and(
          eq(blocks.blockedDid, viewerDid),
          inArray(blocks.blockerDid, targetDids)
        )),
      this.db.select({ did: mutes.mutedDid })
        .from(mutes)
        .where(and(
          eq(mutes.muterDid, viewerDid),
          inArray(mutes.mutedDid, targetDids)
        )),
    ]);

    const followingMap = new Map(followingList.map(f => [f.did, f.uri]));
    const followersMap = new Map(followersList.map(f => [f.did, f.uri]));
    const blockingMap = new Map(blockingList.map(b => [b.did, b.uri]));
    const blockedBySet = new Set(blockedByList.map(b => b.did));
    const mutingSet = new Set(mutingList.map(m => m.did));

    const relationships = new Map();
    for (const targetDid of targetDids) {
      relationships.set(targetDid, {
        following: followingMap.get(targetDid),
        followedBy: followersMap.get(targetDid),
        blocking: blockingMap.get(targetDid),
        blockedBy: blockedBySet.has(targetDid),
        muting: mutingSet.has(targetDid),
      });
    }

    return relationships;
  }

  async getKnownFollowers(actorDid: string, viewerDid: string, limit = 50, cursor?: string): Promise<{ followers: User[], cursor?: string, count: number }> {
    // Compute intersection in SQL: Find users who follow the actor AND are followed by the viewer
    // This scales properly and supports true cursor pagination
    
    // Use raw SQL with proper table aliasing for the self-join
    const cursorCondition = cursor ? sql`AND u.indexed_at < ${new Date(cursor)}` : sql``;

    // Run two queries: one for the total count, one for the paginated results
    const [countResult, results] = await Promise.all([
      this.db.execute<{ count: string }>(sql`
        SELECT COUNT(*)
        FROM users u
        INNER JOIN follows f1 ON u.did = f1.follower_did AND f1.following_did = ${actorDid}
        INNER JOIN follows f2 ON u.did = f2.following_did AND f2.follower_did = ${viewerDid}
      `),
      this.db.execute(sql`
        SELECT u.did, u.handle, u.display_name, u.avatar_url, u.banner_url, u.description, u.indexed_at, u.profile_record, u.created_at
        FROM users u
        INNER JOIN follows f1 ON u.did = f1.follower_did AND f1.following_did = ${actorDid}
        INNER JOIN follows f2 ON u.did = f2.following_did AND f2.follower_did = ${viewerDid}
        WHERE 1=1 ${cursorCondition}
        ORDER BY u.indexed_at DESC
        LIMIT ${limit + 1}
      `)
    ]);
    
    const totalCount = parseInt(countResult.rows[0]?.count || '0', 10);

    const rows = results.rows as any[];
    const hasMore = rows.length > limit;
    const followers: User[] = (hasMore ? rows.slice(0, limit) : rows).map(row => ({
      did: row.did,
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      description: row.description,
      profileRecord: row.profile_record,
      searchVector: null,
      createdAt: row.created_at,
      indexedAt: row.indexed_at,
    }));
    
    const nextCursor = hasMore ? followers[followers.length - 1].indexedAt.toISOString() : undefined;

    return { followers, cursor: nextCursor, count: totalCount };
  }

  async getSuggestedFollowsByActor(actorDid: string, limit = 25): Promise<User[]> {
    // Friends-of-friends algorithm: Get accounts followed by accounts the actor follows
    const actorFollowing = await db
      .select({ followingDid: follows.followingDid })
      .from(follows)
      .where(eq(follows.followerDid, actorDid))
      .limit(100); // Limit to avoid performance issues

    if (actorFollowing.length === 0) {
      return [];
    }

    const followingDids = actorFollowing.map(f => f.followingDid);

    // Get accounts followed by the actor's follows (friends-of-friends)
    const friendsOfFriends = await db
      .select({ 
        followingDid: follows.followingDid,
        count: sql<number>`count(*)::int`
      })
      .from(follows)
      .where(inArray(follows.followerDid, followingDids))
      .groupBy(follows.followingDid)
      .orderBy(desc(sql`count(*)`))
      .limit(limit * 2); // Get extra to filter out existing follows

    // Filter out DIDs the actor already follows and the actor themselves
    const actorFollowingSet = new Set([actorDid, ...followingDids]);
    const suggestedDids = friendsOfFriends
      .filter(f => !actorFollowingSet.has(f.followingDid))
      .slice(0, limit)
      .map(f => f.followingDid);

    if (suggestedDids.length === 0) {
      return [];
    }

    // Fetch user data for suggestions
    return await db
      .select()
      .from(users)
      .where(inArray(users.did, suggestedDids));
  }

  async getTimeline(userDid: string, limit = 50, cursor?: string): Promise<Post[]> {
    const followList = await this.getFollows(userDid);
    const followingDids = followList.map(f => f.followingDid);
    
    console.log(`[STORAGE_DEBUG] getTimeline for ${userDid}: ${followingDids.length} follows`);
    
    if (followingDids.length === 0) {
      // If user has no follows, show all posts (for new users)
      console.log(`[STORAGE_DEBUG] No follows, showing all posts`);
      const conditions = [];
      if (cursor) {
        conditions.push(sql`${posts.indexedAt} < ${cursor}`);
      }
      
      const allPosts = await db
        .select()
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(posts.indexedAt))
        .limit(limit);
        
      console.log(`[STORAGE_DEBUG] Retrieved ${allPosts.length} posts from all users`);
      return allPosts;
    }

    // AT Protocol compliant timeline: include posts from followed users
    // and reposts by followed users
    console.log(`[STORAGE_DEBUG] Following DIDs: ${followingDids.slice(0, 5).join(', ')}${followingDids.length > 5 ? '...' : ''}`);
    
    const conditions = [
      sql`(
        -- Original posts from followed users
        ${inArray(posts.authorDid, followingDids)}
        OR
        -- Reposts by followed users
        EXISTS (
          SELECT 1 FROM ${reposts} 
          WHERE ${inArray(reposts.userDid, followingDids)} 
          AND ${reposts.postUri} = ${posts.uri}
        )
      )`
    ];
    
    if (cursor) {
      conditions.push(sql`${posts.indexedAt} < ${cursor}`);
    }

    const timelinePosts = await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.indexedAt))
      .limit(limit);
      
    console.log(`[STORAGE_DEBUG] Retrieved ${timelinePosts.length} posts from followed users and reposts`);
    return timelinePosts;
  }

  async createSession(session: InsertSession): Promise<Session> {
    // Sanitize before encryption to remove any null bytes
    const sanitized = sanitizeObject(session);
    // Encrypt tokens before storing
    const encryptedSession = {
      ...sanitized,
      accessToken: encryptionService.encrypt(sanitized.accessToken),
      refreshToken: sanitized.refreshToken ? encryptionService.encrypt(sanitized.refreshToken) : null,
    };
    
    const [newSession] = await this.db
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
    const [session] = await this.db.select().from(sessions).where(eq(sessions.id, id));
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
      await this.db.delete(sessions).where(eq(sessions.id, id));
      return undefined;
    }
  }

  async getUserSessions(userDid: string): Promise<Session[]> {
    const sessionList = await this.db.select().from(sessions).where(eq(sessions.userDid, userDid));
    
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
        await this.db.delete(sessions).where(eq(sessions.id, session.id));
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
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.db.delete(sessions).where(sql`${sessions.expiresAt} < NOW()`);
  }

  async saveOAuthState(state: string, stateData: any, expiresAt: Date): Promise<void> {
    const { oauthStates } = await import('@shared/schema');
    await this.db
      .insert(oauthStates)
      .values({
        state,
        stateData,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: oauthStates.state,
        set: {
          stateData,
          expiresAt,
        },
      });
  }

  async getOAuthState(state: string): Promise<any | undefined> {
    const { oauthStates } = await import('@shared/schema');
    const [stateRecord] = await this.db.select().from(oauthStates).where(eq(oauthStates.state, state));
    return stateRecord ? stateRecord.stateData : undefined;
  }

  async deleteOAuthState(state: string): Promise<void> {
    const { oauthStates } = await import('@shared/schema');
    await this.db.delete(oauthStates).where(eq(oauthStates.state, state));
  }

  async deleteExpiredOAuthStates(): Promise<void> {
    const { oauthStates } = await import('@shared/schema');
    await this.db.delete(oauthStates).where(sql`${oauthStates.expiresAt} < NOW()`);
  }

  async getUserSettings(userDid: string): Promise<UserSettings | undefined> {
    const [settings] = await this.db.select().from(userSettings).where(eq(userSettings.userDid, userDid));
    return settings || undefined;
  }

  async createUserSettings(settings: InsertUserSettings): Promise<UserSettings> {
    const sanitized = sanitizeObject(settings);
    const [newSettings] = await this.db
      .insert(userSettings)
      .values(sanitized)
      .onConflictDoUpdate({
        target: userSettings.userDid,
        set: sanitized,
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
    
    // Invalidate cache if dataCollectionForbidden changed
    if (updated && settings.dataCollectionForbidden !== undefined) {
      const { eventProcessor } = await import("./services/event-processor");
      eventProcessor.invalidateDataCollectionCache(userDid);
    }
    
    return updated || undefined;
  }

  async deleteUserData(userDid: string): Promise<void> {
    // Count records before deletion for Redis counter updates
    const [postCount, likeCount, repostCount, followCount, blockCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(posts).where(eq(posts.authorDid, userDid)),
      db.select({ count: sql<number>`count(*)::int` }).from(likes).where(eq(likes.userDid, userDid)),
      db.select({ count: sql<number>`count(*)::int` }).from(reposts).where(eq(reposts.userDid, userDid)),
      db.select({ count: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerDid, userDid)),
      db.select({ count: sql<number>`count(*)::int` }).from(blocks).where(eq(blocks.blockerDid, userDid)),
    ]);

    await db.transaction(async (tx) => {
      // Delete all user-generated content
      await tx.delete(posts).where(eq(posts.authorDid, userDid));
      await tx.delete(likes).where(eq(likes.userDid, userDid));
      await tx.delete(reposts).where(eq(reposts.userDid, userDid));
      await tx.delete(follows).where(eq(follows.followerDid, userDid));
      await tx.delete(blocks).where(eq(blocks.blockerDid, userDid));
      await tx.delete(listItems).where(eq(listItems.subjectDid, userDid));
      await tx.delete(lists).where(eq(lists.creatorDid, userDid));
      await tx.delete(userPreferences).where(eq(userPreferences.userDid, userDid));
      await tx.delete(sessions).where(eq(sessions.userDid, userDid));
      
      // Strip user profile to minimum required for moderation (DID + handle only)
      // Keep the user record so labels can still be applied for moderation
      await tx.update(users).set({
        displayName: null,
        description: null,
        avatarUrl: null,
      }).where(eq(users.did, userDid));
      
      // Upsert userSettings to ensure dataCollectionForbidden is set even if row doesn't exist
      // This prevents future data collection
      await tx.insert(userSettings).values({
        userDid,
        dataCollectionForbidden: true,
        blockedKeywords: [],
        mutedUsers: [],
        customLists: [],
        feedPreferences: {},
        lastBackfillAt: null,
      }).onConflictDoUpdate({
        target: userSettings.userDid,
        set: {
          dataCollectionForbidden: true,
          blockedKeywords: [],
          mutedUsers: [],
          customLists: [],
          feedPreferences: {},
        },
      });
      
      // Note: Labels are NOT deleted - they must be preserved for moderation purposes
      // This ensures the instance can still apply moderation labels even after data deletion
    });
    
    // Update Redis counters for deleted records
    const { redisQueue } = await import("./services/redis-queue");
    await Promise.all([
      redisQueue.incrementRecordCount('posts', -postCount[0].count),
      redisQueue.incrementRecordCount('likes', -likeCount[0].count),
      redisQueue.incrementRecordCount('reposts', -repostCount[0].count),
      redisQueue.incrementRecordCount('follows', -followCount[0].count),
      redisQueue.incrementRecordCount('blocks', -blockCount[0].count),
    ]);
    
    // Invalidate cache to ensure immediate opt-out enforcement
    const { eventProcessor } = await import("./services/event-processor");
    eventProcessor.invalidateDataCollectionCache(userDid);
  }

  // Label operations
  async createLabel(label: InsertLabel): Promise<Label> {
    const sanitized = sanitizeObject(label);
    const [newLabel] = await this.db
      .insert(labels)
      .values(sanitized)
      .onConflictDoNothing()
      .returning();
    return newLabel;
  }

  async getLabel(uri: string): Promise<Label | undefined> {
    const [label] = await this.db.select().from(labels).where(eq(labels.uri, uri));
    return label || undefined;
  }

  async getLabelsForSubject(subject: string): Promise<Label[]> {
    return await this.db.select().from(labels).where(eq(labels.subject, subject));
  }

  async getLabelsForSubjects(subjects: string[]): Promise<Label[]> {
    if (subjects.length === 0) return [];
    return await this.db.select().from(labels).where(inArray(labels.subject, subjects));
  }

  async deleteLabel(uri: string): Promise<void> {
    await this.db.delete(labels).where(eq(labels.uri, uri));
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

    let query = this.db.select().from(labels);
    
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
    const sanitized = sanitizeObject(definition);
    const [newDef] = await this.db
      .insert(labelDefinitions)
      .values(sanitized)
      .onConflictDoUpdate({
        target: labelDefinitions.value,
        set: sanitized,
      })
      .returning();
    return newDef;
  }

  async getLabelDefinition(value: string): Promise<LabelDefinition | undefined> {
    const [def] = await this.db.select().from(labelDefinitions).where(eq(labelDefinitions.value, value));
    return def || undefined;
  }

  async getAllLabelDefinitions(): Promise<LabelDefinition[]> {
    return await this.db.select().from(labelDefinitions).orderBy(labelDefinitions.value);
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
    const sanitized = sanitizeObject(event);
    const [newEvent] = await this.db
      .insert(labelEvents)
      .values(sanitized)
      .returning();
    return newEvent;
  }

  async getRecentLabelEvents(limit = 100, since?: Date): Promise<LabelEvent[]> {
    let query = this.db.select().from(labelEvents);
    
    if (since) {
      query = query.where(sql`${labelEvents.createdAt} > ${since}`) as any;
    }

    return await query.orderBy(desc(labelEvents.createdAt)).limit(limit);
  }

  // Moderation report operations
  async createModerationReport(report: InsertModerationReport): Promise<ModerationReport> {
    const sanitized = sanitizeObject(report);
    const [newReport] = await this.db
      .insert(moderationReports)
      .values(sanitized)
      .returning();
    return newReport;
  }

  async getModerationReport(id: number): Promise<ModerationReport | undefined> {
    const [report] = await this.db.select().from(moderationReports).where(eq(moderationReports.id, id));
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
    const sanitized = sanitizeObject(action);
    const [newAction] = await this.db
      .insert(moderationActions)
      .values(sanitized)
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
    await this.db.delete(lists).where(eq(lists.uri, uri));
  }

  async getList(uri: string): Promise<List | undefined> {
    const [list] = await this.db.select().from(lists).where(eq(lists.uri, uri));
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
    await this.db.delete(listItems).where(eq(listItems.uri, uri));
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

  // Feed generator operations
  async createFeedGenerator(generator: InsertFeedGenerator): Promise<FeedGenerator> {
    const [feedGen] = await db
      .insert(feedGenerators)
      .values(generator)
      .onConflictDoUpdate({
        target: feedGenerators.uri,
        set: {
          cid: generator.cid,
          displayName: generator.displayName,
          description: generator.description,
          avatarUrl: generator.avatarUrl,
          createdAt: generator.createdAt,
          did: generator.did,
          indexedAt: sql`NOW()`,
        },
      })
      .returning();
    return feedGen;
  }

  async deleteFeedGenerator(uri: string): Promise<void> {
    await this.db.delete(feedGenerators).where(eq(feedGenerators.uri, uri));
  }

  async getFeedGenerator(uri: string): Promise<FeedGenerator | undefined> {
    const [generator] = await this.db.select().from(feedGenerators).where(eq(feedGenerators.uri, uri));
    return generator || undefined;
  }

  async getFeedGenerators(uris: string[]): Promise<FeedGenerator[]> {
    if (uris.length === 0) return [];
    return await this.db.select().from(feedGenerators).where(inArray(feedGenerators.uri, uris));
  }

  async getActorFeeds(actorDid: string, limit = 50, cursor?: string): Promise<{ generators: FeedGenerator[], cursor?: string }> {
    const conditions = [eq(feedGenerators.creatorDid, actorDid)];

    if (cursor) {
      conditions.push(sql`${feedGenerators.indexedAt} < ${new Date(cursor)}`);
    }

    const generators = await db
      .select()
      .from(feedGenerators)
      .where(and(...conditions))
      .orderBy(desc(feedGenerators.indexedAt))
      .limit(limit + 1);

    const hasMore = generators.length > limit;
    const results = hasMore ? generators.slice(0, limit) : generators;
    const nextCursor = hasMore ? results[results.length - 1].indexedAt.toISOString() : undefined;

    return { generators: results, cursor: nextCursor };
  }

  async getSuggestedFeeds(limit = 50, cursor?: string): Promise<{ generators: FeedGenerator[], cursor?: string }> {
    const conditions = [];

    if (cursor) {
      const [likeCount, indexedAt] = cursor.split('::');
      conditions.push(
        sql`(${feedGenerators.likeCount}, ${feedGenerators.indexedAt}) < (${parseInt(likeCount)}, ${new Date(indexedAt)})`
      );
    }

    const generators = await db
      .select()
      .from(feedGenerators)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(feedGenerators.likeCount), desc(feedGenerators.indexedAt))
      .limit(limit + 1);

    const hasMore = generators.length > limit;
    const results = hasMore ? generators.slice(0, limit) : generators;
    const nextCursor = hasMore 
      ? `${results[results.length - 1].likeCount}::${results[results.length - 1].indexedAt.toISOString()}`
      : undefined;

    return { generators: results, cursor: nextCursor };
  }

  async updateFeedGenerator(uri: string, data: Partial<InsertFeedGenerator>): Promise<FeedGenerator | undefined> {
    const [generator] = await db
      .update(feedGenerators)
      .set(data)
      .where(eq(feedGenerators.uri, uri))
      .returning();
    return generator || undefined;
  }

  // Starter pack operations
  async createStarterPack(pack: InsertStarterPack): Promise<StarterPack> {
    const [starterPack] = await db
      .insert(starterPacks)
      .values(pack)
      .onConflictDoUpdate({
        target: starterPacks.uri,
        set: {
          cid: pack.cid,
          name: pack.name,
          description: pack.description,
          listUri: pack.listUri,
          feeds: pack.feeds,
          createdAt: pack.createdAt,
          indexedAt: sql`NOW()`,
        },
      })
      .returning();
    return starterPack;
  }

  async deleteStarterPack(uri: string): Promise<void> {
    await this.db.delete(starterPacks).where(eq(starterPacks.uri, uri));
  }

  async getStarterPack(uri: string): Promise<StarterPack | undefined> {
    const [pack] = await this.db.select().from(starterPacks).where(eq(starterPacks.uri, uri));
    return pack || undefined;
  }

  async getStarterPacks(uris: string[]): Promise<StarterPack[]> {
    if (uris.length === 0) return [];
    return await this.db.select().from(starterPacks).where(inArray(starterPacks.uri, uris));
  }

  async listStarterPacks(limit = 50, cursor?: string): Promise<{ starterPacks: StarterPack[]; cursor?: string }> {
    const conditions: any[] = [];
    if (cursor) {
      conditions.push(sql`${starterPacks.indexedAt} < ${new Date(cursor)}`);
    }
    const results = await db
      .select()
      .from(starterPacks)
      .where(conditions.length ? and(...conditions) : undefined as any)
      .orderBy(desc(starterPacks.indexedAt))
      .limit(limit + 1);
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;
    return { starterPacks: items, cursor: nextCursor };
  }

  async getStarterPacksByCreator(creatorDid: string, limit = 50, cursor?: string): Promise<{ starterPacks: StarterPack[]; cursor?: string }> {
    const conditions: any[] = [eq(starterPacks.creatorDid, creatorDid)];
    if (cursor) {
      conditions.push(sql`${starterPacks.indexedAt} < ${new Date(cursor)}`);
    }
    const results = await db
      .select()
      .from(starterPacks)
      .where(and(...conditions))
      .orderBy(desc(starterPacks.indexedAt))
      .limit(limit + 1);
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;
    return { starterPacks: items, cursor: nextCursor };
  }

  async searchStarterPacksByName(q: string, limit = 25, cursor?: string): Promise<{ starterPacks: StarterPack[]; cursor?: string }> {
    const conditions: any[] = [sql`${starterPacks.name} ILIKE ${'%' + q + '%'}`];
    if (cursor) {
      conditions.push(sql`${starterPacks.indexedAt} < ${new Date(cursor)}`);
    }
    const results = await db
      .select()
      .from(starterPacks)
      .where(and(...conditions))
      .orderBy(desc(starterPacks.indexedAt))
      .limit(limit + 1);
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? items[items.length - 1].indexedAt.toISOString() : undefined;
    return { starterPacks: items, cursor: nextCursor };
  }

  // Labeler service operations
  async createLabelerService(service: InsertLabelerService): Promise<LabelerService> {
    const [labelerService] = await db
      .insert(labelerServices)
      .values(service)
      .onConflictDoUpdate({
        target: labelerServices.uri,
        set: {
          cid: service.cid,
          policies: service.policies,
          createdAt: service.createdAt,
          indexedAt: sql`NOW()`,
        },
      })
      .returning();
    return labelerService;
  }

  async deleteLabelerService(uri: string): Promise<void> {
    await this.db.delete(labelerServices).where(eq(labelerServices.uri, uri));
  }

  async getLabelerService(uri: string): Promise<LabelerService | undefined> {
    const [service] = await this.db.select().from(labelerServices).where(eq(labelerServices.uri, uri));
    return service || undefined;
  }

  async getLabelerServices(uris: string[]): Promise<LabelerService[]> {
    if (uris.length === 0) return [];
    return await this.db.select().from(labelerServices).where(inArray(labelerServices.uri, uris));
  }

  async getLabelerServicesByCreator(creatorDid: string): Promise<LabelerService[]> {
    return await this.db.select().from(labelerServices).where(eq(labelerServices.creatorDid, creatorDid));
  }

  async updateLabelerService(uri: string, data: Partial<InsertLabelerService>): Promise<LabelerService | undefined> {
    const [service] = await db
      .update(labelerServices)
      .set(data)
      .where(eq(labelerServices.uri, uri))
      .returning();
    return service || undefined;
  }

  // Push subscription operations
  async createPushSubscription(subscription: InsertPushSubscription): Promise<PushSubscription> {
    const [sub] = await db
      .insert(pushSubscriptions)
      .values(subscription)
      .onConflictDoUpdate({
        target: pushSubscriptions.token,
        set: {
          userDid: subscription.userDid,
          platform: subscription.platform,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          appId: subscription.appId,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();
    return sub;
  }

  async deletePushSubscription(id: number): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async deletePushSubscriptionByToken(token: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.token, token));
  }

  async getUserPushSubscriptions(userDid: string): Promise<PushSubscription[]> {
    return await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userDid, userDid))
      .orderBy(desc(pushSubscriptions.createdAt));
  }

  async getPushSubscription(id: number): Promise<PushSubscription | undefined> {
    const [sub] = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, id))
      .limit(1);
    return sub || undefined;
  }

  async updatePushSubscription(id: number, data: Partial<InsertPushSubscription>): Promise<PushSubscription | undefined> {
    const [sub] = await db
      .update(pushSubscriptions)
      .set({ ...data, updatedAt: sql`NOW()` })
      .where(eq(pushSubscriptions.id, id))
      .returning();
    return sub || undefined;
  }

  // Video job operations
  async createVideoJob(job: InsertVideoJob): Promise<VideoJob> {
    const [videoJob] = await db
      .insert(videoJobs)
      .values(job)
      .returning();
    return videoJob;
  }

  async getVideoJob(jobId: string): Promise<VideoJob | undefined> {
    const [job] = await db
      .select()
      .from(videoJobs)
      .where(eq(videoJobs.jobId, jobId))
      .limit(1);
    return job || undefined;
  }

  async getUserVideoJobs(userDid: string, limit: number = 50): Promise<VideoJob[]> {
    return await db
      .select()
      .from(videoJobs)
      .where(eq(videoJobs.userDid, userDid))
      .orderBy(desc(videoJobs.createdAt))
      .limit(limit);
  }

  async updateVideoJob(jobId: string, data: Partial<InsertVideoJob>): Promise<VideoJob | undefined> {
    const [job] = await db
      .update(videoJobs)
      .set({ ...data, updatedAt: sql`NOW()` })
      .where(eq(videoJobs.jobId, jobId))
      .returning();
    return job || undefined;
  }

  async deleteVideoJob(jobId: string): Promise<void> {
    await this.db.delete(videoJobs).where(eq(videoJobs.jobId, jobId));
  }

  async getFirehoseCursor(service: string): Promise<FirehoseCursor | undefined> {
    const [cursor] = await this.db.select().from(firehoseCursor).where(eq(firehoseCursor.service, service));
    return cursor || undefined;
  }

  async saveFirehoseCursor(service: string, cursor: string | null, lastEventTime?: Date): Promise<void> {
    // Use upsert to handle concurrent saves atomically
    await db
      .insert(firehoseCursor)
      .values({
        service,
        cursor,
        lastEventTime: lastEventTime || new Date(),
      })
      .onConflictDoUpdate({
        target: firehoseCursor.service,
        set: {
          cursor,
          lastEventTime: lastEventTime || new Date(),
          updatedAt: new Date(),
        },
      });
  }

  async getBackfillProgress(): Promise<{ currentCursor: string | null; eventsProcessed: number; lastUpdateTime: Date } | undefined> {
    const [record] = await this.db.select().from(firehoseCursor).where(eq(firehoseCursor.service, "backfill"));
    if (!record) return undefined;
    
    // Parse cursor field which contains both cursor and eventsProcessed encoded as "cursor|eventsProcessed"
    let currentCursor: string | null = record.cursor;
    let eventsProcessed = 0;
    
    if (record.cursor && record.cursor.includes('|')) {
      const parts = record.cursor.split('|');
      currentCursor = parts[0] || null;
      eventsProcessed = parseInt(parts[1] || '0', 10);
    }
    
    return {
      currentCursor,
      eventsProcessed,
      lastUpdateTime: record.lastEventTime || new Date(),
    };
  }

  async saveBackfillProgress(progress: { currentCursor: string | null; eventsProcessed: number; lastUpdateTime: Date }): Promise<void> {
    // Encode both cursor and eventsProcessed in the cursor field as "cursor|eventsProcessed"
    const encodedCursor = `${progress.currentCursor || ''}|${progress.eventsProcessed}`;
    
    await this.db
      .insert(firehoseCursor)
      .values({
        service: "backfill",
        cursor: encodedCursor,
        lastEventTime: progress.lastUpdateTime,
      })
      .onConflictDoUpdate({
        target: firehoseCursor.service,
        set: {
          cursor: encodedCursor,
          lastEventTime: progress.lastUpdateTime,
          updatedAt: new Date(),
        },
      });
  }

  private async refreshStatsInBackground() {
    // Skip if query is already in progress
    if (this.statsQueryInProgress) {
      return;
    }

    this.statsQueryInProgress = true;

    try {
      // Refresh from Redis first (fast)
      const { redisQueue } = await import("./services/redis-queue");
      const redisCounts = await redisQueue.getRecordCounts();
      
      if (Object.keys(redisCounts).length > 0) {
        this.statsCache = {
          data: {
            totalUsers: redisCounts.users || 0,
            totalPosts: redisCounts.posts || 0,
            totalLikes: redisCounts.likes || 0,
            totalReposts: redisCounts.reposts || 0,
            totalFollows: redisCounts.follows || 0,
            totalBlocks: redisCounts.blocks || 0,
          },
          timestamp: Date.now()
        };
      }
    } catch (error) {
      // Silent failure - cache will just be stale
    } finally {
      this.statsQueryInProgress = false;
    }
  }

  async getStats() {
    // ALWAYS return cache immediately if available (even if stale) - never block the API
    if (this.statsCache) {
      // Trigger background refresh if cache is getting stale
      if ((Date.now() - this.statsCache.timestamp) > this.STATS_CACHE_TTL && !this.statsQueryInProgress) {
        this.refreshStatsInBackground();
      }
      return this.statsCache.data;
    }

    // No cache yet - try Redis counters first (fast)
    const { redisQueue } = await import("./services/redis-queue");
    const redisCounts = await redisQueue.getRecordCounts();
    
    if (Object.keys(redisCounts).length > 0) {
      const data = {
        totalUsers: redisCounts.users || 0,
        totalPosts: redisCounts.posts || 0,
        totalLikes: redisCounts.likes || 0,
        totalReposts: redisCounts.reposts || 0,
        totalFollows: redisCounts.follows || 0,
        totalBlocks: redisCounts.blocks || 0,
      };
      // Cache it
      this.statsCache = { data, timestamp: Date.now() };
      return data;
    }

    // No Redis counts - fallback to PostgreSQL query (only on first load)
    if (this.statsQueryInProgress) {
      // Another request is already fetching, return zeros
      return {
        totalUsers: 0,
        totalPosts: 0,
        totalLikes: 0,
        totalReposts: 0,
        totalFollows: 0,
        totalBlocks: 0,
      };
    }

    this.statsQueryInProgress = true;

    try {
      // Add 5 second timeout to prevent blocking
      const statsPromise = this.db.execute<{ schemaname: string; relname: string; count: number }>(sql`
        SELECT 
          schemaname,
          relname,
          n_live_tup as count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
          AND relname IN ('users', 'posts', 'likes', 'reposts', 'follows', 'blocks')
      `);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Stats query timeout")), 5000);
      });

      const result = await Promise.race([statsPromise, timeoutPromise]);

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
      this.statsQueryInProgress = false;
      
      return data;
    } catch (error) {
      this.statsQueryInProgress = false;
      console.error("[STORAGE] Error getting stats:", error);
      
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

  // Post aggregations operations
  async createPostAggregation(aggregation: InsertPostAggregation): Promise<PostAggregation> {
    const [result] = await this.db.insert(postAggregations).values(aggregation).returning();
    
    // Update Redis counter for dashboard metrics
    const { redisQueue } = await import("./services/redis-queue");
    await redisQueue.incrementRecordCount('post_aggregations');
    
    return result;
  }

  async getPostAggregation(postUri: string): Promise<PostAggregation | undefined> {
    const [result] = await this.db.select().from(postAggregations).where(eq(postAggregations.postUri, postUri));
    return result;
  }

  async getPostAggregations(postUris: string[]): Promise<Map<string, PostAggregation>> {
    if (postUris.length === 0) return new Map();
    
    const results = await this.db
      .select()
      .from(postAggregations)
      .where(inArray(postAggregations.postUri, postUris));
    
    const map = new Map<string, PostAggregation>();
    for (const result of results) {
      map.set(result.postUri, result);
    }
    return map;
  }

  async incrementPostAggregation(postUri: string, field: 'likeCount' | 'repostCount' | 'replyCount' | 'bookmarkCount' | 'quoteCount', delta: number): Promise<void> {
    // First, ensure the aggregation record exists
    const existing = await this.getPostAggregation(postUri);
    if (!existing) {
      await this.createPostAggregation({
        postUri,
        likeCount: 0,
        repostCount: 0,
        replyCount: 0,
        bookmarkCount: 0,
        quoteCount: 0,
      });
    }

    // Update the specific field
    const updateData: Partial<InsertPostAggregation> = {};
    updateData[field] = (existing?.[field] || 0) + delta;
    
    await this.db
      .update(postAggregations)
      .set(updateData)
      .where(eq(postAggregations.postUri, postUri));
  }

  async updatePostAggregation(postUri: string, data: Partial<InsertPostAggregation>): Promise<void> {
    await this.db
      .update(postAggregations)
      .set(data)
      .where(eq(postAggregations.postUri, postUri));
  }

  // Post viewer states operations
  async createPostViewerState(viewerState: InsertPostViewerState): Promise<PostViewerState> {
    const [result] = await this.db.insert(postViewerStates).values(viewerState).returning();
    return result;
  }

  async getPostViewerState(postUri: string, viewerDid: string): Promise<PostViewerState | undefined> {
    const [result] = await this.db
      .select()
      .from(postViewerStates)
      .where(and(
        eq(postViewerStates.postUri, postUri),
        eq(postViewerStates.viewerDid, viewerDid)
      ));
    return result;
  }

  async getPostViewerStates(postUris: string[], viewerDid: string): Promise<Map<string, PostViewerState>> {
    if (postUris.length === 0) return new Map();
    
    const results = await this.db
      .select()
      .from(postViewerStates)
      .where(and(
        inArray(postViewerStates.postUri, postUris),
        eq(postViewerStates.viewerDid, viewerDid)
      ));
    
    const map = new Map<string, PostViewerState>();
    for (const result of results) {
      map.set(result.postUri, result);
    }
    return map;
  }

  async updatePostViewerState(postUri: string, viewerDid: string, data: Partial<InsertPostViewerState>): Promise<void> {
    await this.db
      .update(postViewerStates)
      .set(data)
      .where(and(
        eq(postViewerStates.postUri, postUri),
        eq(postViewerStates.viewerDid, viewerDid)
      ));
  }

  async deletePostViewerState(postUri: string, viewerDid: string): Promise<void> {
    await this.db
      .delete(postViewerStates)
      .where(and(
        eq(postViewerStates.postUri, postUri),
        eq(postViewerStates.viewerDid, viewerDid)
      ));
  }

  // Thread context operations
  async createThreadContext(context: InsertThreadContext): Promise<ThreadContext> {
    const [result] = await this.db.insert(threadContexts).values(context).returning();
    return result;
  }

  async getThreadContext(postUri: string): Promise<ThreadContext | undefined> {
    const [result] = await this.db.select().from(threadContexts).where(eq(threadContexts.postUri, postUri));
    return result;
  }

  async getThreadContexts(postUris: string[]): Promise<Map<string, ThreadContext>> {
    if (postUris.length === 0) return new Map();
    
    const results = await this.db
      .select()
      .from(threadContexts)
      .where(inArray(threadContexts.postUri, postUris));
    
    const map = new Map<string, ThreadContext>();
    for (const result of results) {
      map.set(result.postUri, result);
    }
    return map;
  }

  async updateThreadContext(postUri: string, data: Partial<InsertThreadContext>): Promise<void> {
    await this.db
      .update(threadContexts)
      .set(data)
      .where(eq(threadContexts.postUri, postUri));
  }
}

// Factory function to create storage instance with optional custom db connection
export function createStorage(dbConnection?: DbConnection): IStorage {
  return new DatabaseStorage(dbConnection);
}

// Main application storage instance (uses default db connection pool)
export const storage = new DatabaseStorage();
