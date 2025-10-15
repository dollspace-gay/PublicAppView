/**
 * Database Model Types
 * Type definitions for database query results and storage models
 */

/**
 * User/Actor model
 */
export interface UserModel {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  createdAt: Date;
  indexedAt?: Date;
  pronouns?: string;
  pinnedPost?: {
    uri: string;
    cid: string;
  };
}

/**
 * Post model
 */
export interface PostModel {
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  createdAt: Date;
  indexedAt: Date;
  embed?: Record<string, unknown>;
  facets?: Record<string, unknown>[];
  parentUri?: string;
  rootUri?: string;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
}

/**
 * Post aggregation stats
 */
export interface PostAggregation {
  uri: string;
  replyCount: number;
  repostCount: number;
  likeCount: number;
  quoteCount: number;
  bookmarkCount: number;
}

/**
 * Post viewer state
 */
export interface PostViewerState {
  postUri: string;
  viewerDid: string;
  likeUri?: string;
  repostUri?: string;
  bookmarked: boolean;
  threadMuted: boolean;
  replyDisabled: boolean;
  embeddingDisabled: boolean;
  pinned: boolean;
}

/**
 * Follow model
 */
export interface FollowModel {
  uri: string;
  followerDid: string;
  subjectDid: string;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * Like model
 */
export interface LikeModel {
  uri: string;
  userDid: string;
  subjectUri: string;
  subjectCid: string;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * Repost model
 */
export interface RepostModel {
  uri: string;
  userDid: string;
  subjectUri: string;
  subjectCid: string;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * Block model
 */
export interface BlockModel {
  uri: string;
  blockerDid: string;
  subjectDid: string;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * Bookmark model
 */
export interface BookmarkModel {
  uri: string;
  userDid: string;
  postUri: string;
  createdAt: Date;
}

/**
 * List model
 */
export interface ListModel {
  uri: string;
  cid: string;
  creatorDid: string;
  name: string;
  purpose: string;
  description?: string;
  avatarUrl?: string;
  itemCount: number;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * List item model
 */
export interface ListItemModel {
  uri: string;
  listUri: string;
  subjectDid: string;
  createdAt: Date;
}

/**
 * List mute
 */
export interface ListMuteModel {
  userDid: string;
  listUri: string;
  createdAt: Date;
}

/**
 * List block
 */
export interface ListBlockModel {
  userDid: string;
  listUri: string;
  createdAt: Date;
}

/**
 * Thread gate model
 */
export interface ThreadGateModel {
  uri: string;
  postUri: string;
  allowMentions: boolean;
  allowFollowing: boolean;
  allowListUris?: string[];
  createdAt: Date;
}

/**
 * Feed generator model
 */
export interface FeedGeneratorModel {
  uri: string;
  cid: string;
  creatorDid: string;
  feedDid: string;
  displayName: string;
  description?: string;
  avatarUrl?: string;
  likeCount: number;
  acceptsInteractions: boolean;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * Starter pack model
 */
export interface StarterPackModel {
  uri: string;
  cid: string;
  creatorDid: string;
  name: string;
  description?: string;
  listUri?: string;
  feedUris?: string[];
  createdAt: Date;
  indexedAt: Date;
}

/**
 * Labeler service model
 */
export interface LabelerServiceModel {
  uri: string;
  cid: string;
  creatorDid: string;
  policies?: Record<string, unknown>;
  likeCount: number;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * Label model
 */
export interface LabelModel {
  id: number;
  src: string;
  subject: string;
  subjectCid?: string;
  val: string;
  neg: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Notification model
 */
export interface NotificationModel {
  id: number;
  recipientDid: string;
  authorDid: string;
  uri: string;
  cid: string;
  reason: string;
  reasonSubject?: string;
  isRead: boolean;
  createdAt: Date;
  indexedAt: Date;
}

/**
 * User preferences model
 */
export interface UserPreferencesModel {
  userDid: string;
  preferences: Record<string, unknown>[];
  updatedAt: Date;
}

/**
 * Push subscription model
 */
export interface PushSubscriptionModel {
  id: string;
  userDid: string;
  platform: 'ios' | 'android' | 'web';
  token: string;
  appId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Video job model
 */
export interface VideoJobModel {
  jobId: string;
  userDid: string;
  state: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  blobRef?: Record<string, unknown>;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session model
 */
export interface SessionModel {
  id: string;
  userDid: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Relationship between actors
 */
export interface ActorRelationship {
  did: string;
  following?: string; // URI of follow record
  followedBy?: string; // URI of follow record
  blocking?: string; // URI of block record
  blockedBy?: boolean;
  muted?: boolean;
  mutedByList?: {
    listUri: string;
    name?: string;
  };
  blockingByList?: {
    listUri: string;
    name?: string;
  };
}

/**
 * Pagination cursor
 */
export interface CursorPagination {
  cursor?: string;
}

/**
 * Timeline feed result
 */
export interface TimelineFeedResult {
  posts: PostModel[];
  cursor?: string;
}

/**
 * Author feed result
 */
export interface AuthorFeedResult {
  items: AuthorFeedItem[];
  cursor?: string;
}

export interface AuthorFeedItem {
  post: {
    uri: string;
    cid: string;
  };
  repost?: {
    uri: string;
    createdAt: Date;
  };
  authorPinned?: boolean;
}

/**
 * Search results
 */
export interface PostSearchResult {
  posts: PostModel[];
  cursor?: string;
}

export interface ActorSearchResult {
  actors: Array<{ did: string; relevance: number }>;
  cursor?: string;
}

/**
 * Stats
 */
export interface SystemStats {
  totalUsers: number;
  totalPosts: number;
  totalFollows: number;
  totalLikes: number;
  totalReposts: number;
}

/**
 * Hydration state (for optimized post serialization)
 */
export interface HydrationState {
  posts: Map<string, HydratedPost>;
  actors: Map<string, HydratedActor>;
  aggregations: Map<string, PostAggregation>;
  viewerStates: Map<string, PostViewerState>;
  actorViewerStates: Map<string, ActorViewerState>;
  labels: Map<string, LabelModel[]>;
  embeds: Map<string, Record<string, unknown>>;
  threadGates?: Map<string, ThreadGateModel>;
  postGates?: Map<string, unknown>;
  stats: {
    cacheHits: number;
    cacheMisses: number;
    queryTime: number;
    totalTime: number;
  };
}

export interface HydratedPost {
  uri: string;
  cid: string;
  text: string;
  createdAt: string;
  indexedAt: string;
  embed?: Record<string, unknown>;
  facets?: Record<string, unknown>[];
  reply?: {
    parent: { uri: string };
    root: { uri: string };
  };
}

export interface HydratedActor {
  did: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  pronouns?: string;
  createdAt?: Date;
}

export interface ActorViewerState {
  muted?: boolean;
  mutedByList?: {
    listUri: string;
    name?: string;
  };
  blockedBy?: boolean;
  blocking?: string;
  blockingByList?: {
    listUri: string;
    name?: string;
  };
  following?: string;
  followedBy?: string;
  knownFollowers?: {
    count: number;
    followers: HydratedActor[];
  };
}
