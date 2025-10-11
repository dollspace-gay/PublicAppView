// Feed types matching Bluesky's implementation
import { Record as PostRecord } from '../lexicon/types/app/bsky/feed/post';
import { Record as LikeRecord } from '../lexicon/types/app/bsky/feed/like';
import { Record as RepostRecord } from '../lexicon/types/app/bsky/feed/repost';
import { Record as FeedGenRecord } from '../lexicon/types/app/bsky/feed/generator';
import { Record as ThreadgateRecord } from '../lexicon/types/app/bsky/feed/threadgate';
import { Record as PostgateRecord } from '../lexicon/types/app/bsky/feed/postgate';
import { RecordInfo, ItemRef } from './hydration';

export interface Post extends RecordInfo<PostRecord> {
  violatesThreadGate: boolean;
  violatesEmbeddingRules: boolean;
  hasThreadGate: boolean;
  hasPostGate: boolean;
  tags: Set<string>;
}

export type Posts = Map<string, Post>;

export interface PostViewerState {
  like?: string;
  repost?: string;
  bookmarked?: boolean;
  threadMuted?: boolean;
  replyDisabled?: boolean;
  embeddingDisabled?: boolean;
  pinned?: boolean;
}

export type PostViewerStates = Map<string, PostViewerState>;

export interface ThreadContext {
  // Whether the root author has liked the post.
  like?: string;
}

export type ThreadContexts = Map<string, ThreadContext>;

export interface PostAgg {
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  bookmarks: number;
}

export type PostAggs = Map<string, PostAgg>;

export interface Like extends RecordInfo<LikeRecord> {}
export type Likes = Map<string, Like>;

export interface Repost extends RecordInfo<RepostRecord> {}
export type Reposts = Map<string, Repost>;

export interface FeedGenAgg {
  likes: number;
}

export type FeedGenAggs = Map<string, FeedGenAgg>;

export interface FeedGen extends RecordInfo<FeedGenRecord> {}
export type FeedGens = Map<string, FeedGen>;

export interface FeedGenViewerState {
  like?: string;
}

export type FeedGenViewerStates = Map<string, FeedGenViewerState>;

export interface Threadgate extends RecordInfo<ThreadgateRecord> {}
export type Threadgates = Map<string, Threadgate>;

export interface Postgate extends RecordInfo<PostgateRecord> {}
export type Postgates = Map<string, Postgate>;

export interface ThreadRef extends ItemRef {
  threadRoot: string;
}

// Feed item types matching Bluesky's implementation
export interface FeedItem {
  post: ItemRef;
  repost?: ItemRef;
  /**
   * If true, overrides the `reason` with `app.bsky.feed.defs#reasonPin`. Used
   * only in author feeds.
   */
  authorPinned?: boolean;
}

// Feed view post structure
export interface FeedViewPost {
  post: PostView;
  reason?: ReasonRepost | ReasonPin;
  reply?: ReplyRef;
}

export interface PostView {
  uri: string;
  cid: string;
  author: ProfileViewBasic;
  record: PostRecord;
  embed?: EmbedView;
  replyCount: number;
  repostCount: number;
  likeCount: number;
  quoteCount: number;
  bookmarkCount: number;
  indexedAt: string;
  viewer?: PostViewerState;
  labels?: Label[];
  threadgate?: ThreadgateView;
}

export interface ProfileViewBasic {
  $type: 'app.bsky.actor.defs#profileViewBasic';
  did: string;
  handle: string;
  displayName?: string;
  pronouns?: string;
  avatar?: string;
  associated?: ProfileAssociated;
  viewer?: ViewerState;
  labels?: Label[];
  createdAt?: string;
  verification?: VerificationState;
  status?: StatusView;
}

export interface ProfileAssociated {
  lists?: number;
  feedgens?: number;
  starterPacks?: number;
  labeler?: boolean;
  chat?: ProfileAssociatedChat;
  activitySubscription?: ProfileAssociatedActivitySubscription;
}

export interface ProfileAssociatedChat {
  allowIncoming: 'all' | 'none' | 'following' | string;
}

export interface ProfileAssociatedActivitySubscription {
  allowSubscriptions: 'followers' | 'mutuals' | 'none' | string;
}

export interface ViewerState {
  muted?: boolean;
  mutedByList?: ListViewBasic;
  blockedBy?: boolean;
  blocking?: string;
  blockingByList?: ListViewBasic;
  following?: string;
  followedBy?: string;
  knownFollowers?: KnownFollowers;
  activitySubscription?: ActivitySubscription;
}

export interface ListViewBasic {
  $type: 'app.bsky.graph.defs#listViewBasic';
  uri: string;
  name: string;
  purpose: string;
}

export interface KnownFollowers {
  count: number;
  followers: ProfileViewBasic[];
}

export interface ActivitySubscription {
  post: boolean;
  reply: boolean;
}

export interface VerificationState {
  verifications: VerificationView[];
  verifiedStatus: 'valid' | 'invalid' | 'none' | string;
  trustedVerifierStatus: 'valid' | 'invalid' | 'none' | string;
}

export interface VerificationView {
  issuer: string;
  uri: string;
  isValid: boolean;
  createdAt: string;
}

export interface StatusView {
  status: string;
  record: any;
  embed?: ExternalEmbedView;
  expiresAt?: string;
  isActive?: boolean;
}

export interface Label {
  src: string;
  uri: string;
  cid: string;
  val: string;
  cts: string;
}

export interface ReplyRef {
  root: PostView | NotFoundPost | BlockedPost;
  parent: PostView | NotFoundPost | BlockedPost;
  grandparentAuthor?: ProfileViewBasic;
}

export interface ReasonRepost {
  $type: 'app.bsky.feed.defs#reasonRepost';
  by: ProfileViewBasic;
  uri: string;
  cid: string;
  indexedAt: string;
}

export interface ReasonPin {
  $type: 'app.bsky.feed.defs#reasonPin';
}

export interface NotFoundPost {
  $type: 'app.bsky.feed.defs#notFoundPost';
  uri: string;
  notFound: boolean;
}

export interface BlockedPost {
  $type: 'app.bsky.feed.defs#blockedPost';
  uri: string;
  blocked: boolean;
  author: {
    did: string;
    viewer?: ViewerState;
  };
}

export interface ThreadgateView {
  uri: string;
  cid: string;
  record: ThreadgateRecord;
  lists?: ListViewBasic[];
}

// Embed types
export type EmbedView = 
  | ImagesEmbedView
  | VideoEmbedView
  | ExternalEmbedView
  | RecordEmbedView
  | RecordWithMediaView;

export interface ImagesEmbedView {
  $type: 'app.bsky.embed.images#view';
  images: ImageView[];
}

export interface VideoEmbedView {
  $type: 'app.bsky.embed.video#view';
  cid: string;
  playlist: string;
  thumbnail: string;
  alt?: string;
  aspectRatio?: number;
}

export interface ExternalEmbedView {
  $type: 'app.bsky.embed.external#view';
  external: {
    uri: string;
    title: string;
    description: string;
    thumb?: string;
  };
}

export interface RecordEmbedView {
  $type: 'app.bsky.embed.record#view';
  record: RecordEmbedViewInternal;
}

export interface RecordWithMediaView {
  $type: 'app.bsky.embed.recordWithMedia#view';
  media: ImagesEmbedView | VideoEmbedView | ExternalEmbedView;
  record: RecordEmbedView;
}

export type RecordEmbedViewInternal = 
  | PostEmbedView
  | GeneratorView
  | ListView
  | LabelerView
  | StarterPackViewBasic;

export interface PostEmbedView {
  $type: 'app.bsky.embed.record#viewRecord';
  uri: string;
  cid: string;
  author: ProfileViewBasic;
  value: PostRecord;
  labels?: Label[];
  likeCount: number;
  replyCount: number;
  repostCount: number;
  quoteCount: number;
  indexedAt: string;
  embeds?: EmbedView[];
}

export interface GeneratorView {
  $type: 'app.bsky.feed.defs#generatorView';
  uri: string;
  cid: string;
  did: string;
  creator: ProfileView;
  displayName: string;
  description?: string;
  descriptionFacets?: any[];
  avatar?: string;
  likeCount: number;
  acceptsInteractions?: boolean;
  labels?: Label[];
  viewer?: {
    like?: string;
  };
  contentMode?: string;
  indexedAt: string;
}

export interface ListView {
  $type: 'app.bsky.graph.defs#listView';
  uri: string;
  cid: string;
  name: string;
  purpose: string;
  description?: string;
  descriptionFacets?: any[];
  avatar?: string;
  listItemCount: number;
  indexedAt: string;
  labels?: Label[];
  viewer?: {
    muted?: boolean;
    blocked?: boolean;
  };
  creator: ProfileView;
}

export interface LabelerView {
  $type: 'app.bsky.labeler.defs#labelerView';
  uri: string;
  cid: string;
  creator: ProfileView;
  likeCount: number;
  labels?: Label[];
  viewer?: {
    like?: string;
  };
  indexedAt: string;
}

export interface StarterPackViewBasic {
  $type: 'app.bsky.graph.defs#starterPackViewBasic';
  uri: string;
  cid: string;
  record: any;
  creator: ProfileViewBasic;
  joinedAllTimeCount: number;
  joinedWeekCount: number;
  labels?: Label[];
  indexedAt: string;
}

export interface ProfileView extends ProfileViewBasic {
  description?: string;
  indexedAt?: string;
}

export interface ImageView {
  thumb: string;
  fullsize: string;
  alt?: string;
  aspectRatio?: number;
}

// Legacy types for backward compatibility
export enum FeedType {
  POSTS_WITH_REPLIES = 'posts_with_replies',
  POSTS_NO_REPLIES = 'posts_no_replies', 
  POSTS_WITH_MEDIA = 'posts_with_media',
  POSTS_AND_AUTHOR_THREADS = 'posts_and_author_threads',
  POSTS_WITH_VIDEO = 'posts_with_video',
}

export enum FeedItemType {
  POST = 'post',
  REPOST = 'repost',
  REPLY = 'reply',
}

// Filter to feed type mapping
export const FILTER_TO_FEED_TYPE = {
  posts_with_replies: undefined, // default: all posts, replies, and reposts
  posts_no_replies: FeedType.POSTS_NO_REPLIES,
  posts_with_media: FeedType.POSTS_WITH_MEDIA,
  posts_and_author_threads: FeedType.POSTS_AND_AUTHOR_THREADS,
  posts_with_video: FeedType.POSTS_WITH_VIDEO,
} as const;