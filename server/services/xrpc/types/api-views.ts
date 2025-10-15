/**
 * API View Types
 * Type definitions for API response objects (views)
 */

import type { Facet, AspectRatio } from './atproto-records';

/**
 * Actor/Profile Views
 */

export interface ProfileViewBasic {
  $type?: 'app.bsky.actor.defs#profileViewBasic';
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  associated?: ProfileAssociated;
  viewer?: ViewerState;
  labels?: Label[];
  createdAt?: string;
  pronouns?: string;
}

export interface ProfileView {
  $type?: 'app.bsky.actor.defs#profileView';
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  associated?: ProfileAssociated;
  indexedAt?: string;
  viewer?: ViewerState;
  labels?: Label[];
  createdAt?: string;
  pronouns?: string;
}

export interface ProfileViewDetailed {
  $type?: 'app.bsky.actor.defs#profileViewDetailed';
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  associated?: ProfileAssociated;
  indexedAt?: string;
  viewer?: ViewerState;
  labels?: Label[];
  createdAt?: string;
  pinnedPost?: PostView;
  pronouns?: string;
}

export interface ProfileAssociated {
  $type?: 'app.bsky.actor.defs#profileAssociated';
  lists?: number;
  feedgens?: number;
  starterPacks?: number;
  labeler?: boolean;
  chat?: {
    allowIncoming: string;
  };
}

export interface ViewerState {
  $type?: 'app.bsky.actor.defs#viewerState';
  muted?: boolean;
  mutedByList?: ListViewBasic;
  blockedBy?: boolean;
  blocking?: string;
  blockingByList?: ListViewBasic;
  following?: string;
  followedBy?: string;
  knownFollowers?: KnownFollowers;
}

export interface KnownFollowers {
  count: number;
  followers: ProfileViewBasic[];
}

/**
 * Post Views
 */

export interface PostView {
  $type?: 'app.bsky.feed.defs#postView';
  uri: string;
  cid: string;
  author: ProfileViewBasic;
  record: Record<string, unknown>;
  embed?: EmbedView;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
  indexedAt: string;
  viewer?: PostViewerState;
  labels?: Label[];
  threadgate?: ThreadgateView;
}

export interface PostViewerState {
  $type?: 'app.bsky.feed.defs#viewerState';
  repost?: string;
  like?: string;
  threadMuted?: boolean;
  replyDisabled?: boolean;
  embeddingDisabled?: boolean;
  pinned?: boolean;
  bookmarked?: boolean;
}

export interface ThreadgateView {
  $type?: 'app.bsky.feed.defs#threadgateView';
  uri: string;
  cid: string;
  record: Record<string, unknown>;
  lists?: ListViewBasic[];
}

/**
 * Embed Views
 */

export type EmbedView =
  | ImagesView
  | ExternalView
  | RecordView
  | RecordWithMediaView
  | VideoView;

export interface ImagesView {
  $type: 'app.bsky.embed.images#view';
  images: ImageView[];
}

export interface ImageView {
  thumb: string;
  fullsize: string;
  alt: string;
  aspectRatio?: AspectRatio;
}

export interface ExternalView {
  $type: 'app.bsky.embed.external#view';
  external: {
    uri: string;
    title: string;
    description: string;
    thumb?: string;
  };
}

export interface RecordView {
  $type: 'app.bsky.embed.record#view';
  record: RecordViewRecord | RecordViewNotFound | RecordViewBlocked;
}

export interface RecordViewRecord {
  $type: 'app.bsky.embed.record#viewRecord';
  uri: string;
  cid: string;
  author: ProfileViewBasic;
  value: Record<string, unknown>;
  labels?: Label[];
  embeds?: EmbedView[];
  indexedAt: string;
}

export interface RecordViewNotFound {
  $type: 'app.bsky.embed.record#viewNotFound';
  uri: string;
  notFound: true;
}

export interface RecordViewBlocked {
  $type: 'app.bsky.embed.record#viewBlocked';
  uri: string;
  blocked: true;
  author: {
    did: string;
    viewer?: {
      blockedBy?: boolean;
      blocking?: string;
    };
  };
}

export interface RecordWithMediaView {
  $type: 'app.bsky.embed.recordWithMedia#view';
  record: RecordView;
  media: ImagesView | ExternalView | VideoView;
}

export interface VideoView {
  $type: 'app.bsky.embed.video#view';
  cid: string;
  playlist: string;
  thumbnail?: string;
  alt?: string;
  aspectRatio?: AspectRatio;
}

/**
 * Feed Views
 */

export interface FeedViewPost {
  post: PostView;
  reply?: ReplyRefView;
  reason?: ReasonRepost;
  feedContext?: string;
}

export interface ReplyRefView {
  root: PostView | ReasonNotFound | ReasonBlocked;
  parent: PostView | ReasonNotFound | ReasonBlocked;
  grandparentAuthor?: ProfileViewBasic;
}

export interface ReasonRepost {
  $type: 'app.bsky.feed.defs#reasonRepost';
  by: ProfileViewBasic;
  indexedAt: string;
}

export interface ReasonNotFound {
  $type: 'app.bsky.feed.defs#notFoundPost';
  uri: string;
  notFound: true;
}

export interface ReasonBlocked {
  $type: 'app.bsky.feed.defs#blockedPost';
  uri: string;
  blocked: true;
  author: {
    did: string;
    viewer?: ViewerState;
  };
}

/**
 * Thread Views
 */

export type ThreadViewPost = ThreadPost | ThreadNotFound | ThreadBlocked;

export interface ThreadPost {
  $type: 'app.bsky.feed.defs#threadViewPost';
  post: PostView;
  parent?: ThreadViewPost;
  replies?: ThreadViewPost[];
}

export interface ThreadNotFound {
  $type: 'app.bsky.feed.defs#notFoundPost';
  uri: string;
  notFound: true;
}

export interface ThreadBlocked {
  $type: 'app.bsky.feed.defs#blockedPost';
  uri: string;
  blocked: true;
  author: {
    did: string;
    viewer?: ViewerState;
  };
}

/**
 * List Views
 */

export interface ListViewBasic {
  $type?: 'app.bsky.graph.defs#listViewBasic';
  uri: string;
  cid: string;
  name: string;
  purpose: string;
  avatar?: string;
  listItemCount?: number;
  labels?: Label[];
  viewer?: ListViewerState;
  indexedAt?: string;
}

export interface ListView {
  $type?: 'app.bsky.graph.defs#listView';
  uri: string;
  cid: string;
  creator: ProfileViewBasic;
  name: string;
  purpose: string;
  description?: string;
  descriptionFacets?: Facet[];
  avatar?: string;
  listItemCount?: number;
  labels?: Label[];
  viewer?: ListViewerState;
  indexedAt: string;
}

export interface ListViewerState {
  muted?: boolean;
  blocked?: string;
}

export interface ListItemView {
  $type?: 'app.bsky.graph.defs#listItemView';
  uri: string;
  subject: ProfileView;
}

/**
 * Feed Generator Views
 */

export interface GeneratorView {
  $type?: 'app.bsky.feed.defs#generatorView';
  uri: string;
  cid: string;
  did: string;
  creator: ProfileView;
  displayName: string;
  description?: string;
  descriptionFacets?: Facet[];
  avatar?: string;
  likeCount?: number;
  acceptsInteractions?: boolean;
  labels?: Label[];
  viewer?: GeneratorViewerState;
  indexedAt: string;
}

export interface GeneratorViewerState {
  like?: string;
}

/**
 * Starter Pack Views
 */

export interface StarterPackView {
  $type?: 'app.bsky.graph.defs#starterPackView';
  uri: string;
  cid: string;
  record: Record<string, unknown>;
  creator: ProfileViewBasic;
  list?: ListViewBasic;
  listItemsSample?: ListItemView[];
  feeds?: GeneratorView[];
  joinedWeekCount?: number;
  joinedAllTimeCount?: number;
  labels?: Label[];
  indexedAt: string;
}

/**
 * Label
 */

export interface Label {
  $type?: 'com.atproto.label.defs#label';
  ver?: number;
  src: string;
  uri: string;
  cid?: string;
  val: string;
  neg?: boolean;
  cts: string;
  exp?: string;
  sig?: Uint8Array;
}

/**
 * Notification
 */

export interface Notification {
  uri: string;
  cid: string;
  author: ProfileView;
  reason:
    | 'like'
    | 'repost'
    | 'follow'
    | 'mention'
    | 'reply'
    | 'quote'
    | 'starterpack-joined';
  reasonSubject?: string;
  record: Record<string, unknown>;
  isRead: boolean;
  indexedAt: string;
  labels?: Label[];
}

/**
 * Preferences
 */

export type Preference = Record<string, unknown> & {
  $type: string;
};

export interface AdultContentPref {
  $type: 'app.bsky.actor.defs#adultContentPref';
  enabled: boolean;
}

export interface ContentLabelPref {
  $type: 'app.bsky.actor.defs#contentLabelPref';
  label: string;
  visibility: 'ignore' | 'show' | 'warn' | 'hide';
}

export interface SavedFeedsPref {
  $type: 'app.bsky.actor.defs#savedFeedsPref';
  pinned: string[];
  saved: string[];
  timelineIndex?: number;
}

export interface PersonalDetailsPref {
  $type: 'app.bsky.actor.defs#personalDetailsPref';
  birthDate?: string;
}

export interface FeedViewPref {
  $type: 'app.bsky.actor.defs#feedViewPref';
  feed: string;
  hideReplies?: boolean;
  hideRepliesByUnfollowed?: boolean;
  hideRepliesByLikeCount?: number;
  hideReposts?: boolean;
  hideQuotePosts?: boolean;
}

export interface ThreadViewPref {
  $type: 'app.bsky.actor.defs#threadViewPref';
  sort?: 'oldest' | 'newest' | 'most-likes' | 'random';
  prioritizeFollowedUsers?: boolean;
}

export interface InterestsPref {
  $type: 'app.bsky.actor.defs#interestsPref';
  tags: string[];
}

export interface MutedWordsPref {
  $type: 'app.bsky.actor.defs#mutedWordsPref';
  items: MutedWord[];
}

export interface MutedWord {
  id?: string;
  value: string;
  targets: Array<'content' | 'tag'>;
  actorTarget?: 'all' | 'exclude-following';
  expiresAt?: string;
}

export interface HiddenPostsPref {
  $type: 'app.bsky.actor.defs#hiddenPostsPref';
  items: string[];
}

export interface LabelersPref {
  $type: 'app.bsky.actor.defs#labelersPref';
  labelers: LabelerPrefItem[];
}

export interface LabelerPrefItem {
  did: string;
}

export interface BskyAppStatePref {
  $type: 'app.bsky.actor.defs#bskyAppStatePref';
  activeProgressGuide?: unknown;
  queuedNudges?: string[];
  nuxs?: Nux[];
}

export interface Nux {
  id: string;
  completed: boolean;
  data?: string;
  expiresAt?: string;
}
