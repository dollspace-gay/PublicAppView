/**
 * Internal RPC Types
 *
 * These types define the contract between the data-plane server
 * and the AppView client. They are intentionally simple and
 * focused on data retrieval, not lexicon compliance.
 */

// Common pagination
export interface Pagination {
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  cursor?: string;
}

// Profile queries
export interface GetProfileRequest {
  actor: string; // DID or handle
}

export interface GetProfilesRequest {
  actors: string[]; // DIDs or handles
}

export interface ProfileRecord {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  indexedAt: string;
}

export interface SearchActorsRequest extends Pagination {
  query: string;
  limit?: number;
}

// Feed queries
export interface GetAuthorFeedRequest extends Pagination {
  actor: string; // DID or handle
  filter?: 'posts_with_replies' | 'posts_no_replies' | 'posts_with_media';
  limit?: number;
}

export interface GetTimelineRequest extends Pagination {
  actor: string; // Viewer DID
  limit?: number;
}

export interface GetPostThreadRequest {
  uri: string;
  depth?: number;
  parentHeight?: number;
  viewerDid?: string; // For filtering blocked/muted content
}

export interface GetPostRequest {
  uri: string;
}

export interface GetPostsRequest {
  uris: string[];
}

export interface PostRecord {
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  parentUri?: string;
  rootUri?: string;
  embed?: any;
  facets?: any;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  indexedAt: string;
  createdAt: string;
}

export interface FeedItemRecord {
  uri: string;
  postUri: string;
  originatorDid: string;
  type: 'post' | 'repost';
  sortAt: string;
  post: PostRecord;
  repostUri?: string;
}

export interface ThreadRecord {
  post: PostRecord;
  parent?: ThreadRecord;
  replies?: ThreadRecord[];
}

// Graph queries
export interface GetFollowersRequest extends Pagination {
  actor: string; // DID or handle
  limit?: number;
}

export interface GetFollowsRequest extends Pagination {
  actor: string; // DID or handle
  limit?: number;
}

export interface GetRelationshipsRequest {
  actor: string; // Viewer DID
  others: string[]; // Other DIDs to check relationships with
}

export interface FollowRecord {
  uri: string;
  followerDid: string;
  followingDid: string;
  createdAt: string;
}

export interface RelationshipRecord {
  did: string;
  following?: string; // URI of follow record if following
  followedBy?: string; // URI of follow record if followed by
  blocking?: string; // URI of block record if blocking
  blockedBy?: boolean; // True if blocked by
  muting?: boolean; // True if muting
}

// Search
export interface SearchPostsRequest extends Pagination {
  query: string;
  author?: string;
  since?: string;
  until?: string;
  mentions?: string[];
  limit?: number;
}

// Notifications
export interface ListNotificationsRequest extends Pagination {
  actor: string; // Viewer DID
  limit?: number;
  seenAt?: string;
}

export interface GetUnreadCountRequest {
  actor: string; // Viewer DID
  seenAt?: string;
}

export interface NotificationRecord {
  uri: string;
  recipientDid: string;
  authorDid: string;
  reason: 'like' | 'repost' | 'follow' | 'mention' | 'reply' | 'quote';
  reasonSubject?: string;
  isRead: boolean;
  indexedAt: string;
  createdAt: string;
}

export interface UnreadCountResponse {
  count: number;
}

// Feed Generators
export interface GetFeedGeneratorsRequest {
  uris: string[];
}

export interface GetFeedGeneratorRequest {
  feed: string; // URI or DID
}

export interface FeedGeneratorRecord {
  uri: string;
  cid: string;
  creatorDid: string;
  did: string;
  displayName: string;
  description?: string;
  avatarUrl?: string;
  likeCount?: number;
  indexedAt: string;
  createdAt: string;
}
