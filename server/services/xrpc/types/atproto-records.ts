/**
 * ATProto Record Types
 * Type definitions for ATProto records (posts, profiles, follows, etc.)
 */

/**
 * Base record interface
 */
export interface AtprotoRecord {
  $type: string;
  [key: string]: unknown;
}

/**
 * Strong reference to another record
 */
export interface StrongRef {
  uri: string;
  cid: string;
}

/**
 * Blob reference
 */
export interface BlobRef {
  $type: 'blob';
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
}

/**
 * Post record
 */
export interface PostRecord extends AtprotoRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  embed?: PostEmbed;
  facets?: Facet[];
  reply?: ReplyRef;
  langs?: string[];
  labels?: SelfLabels;
  tags?: string[];
}

/**
 * Reply reference
 */
export interface ReplyRef {
  root: StrongRef;
  parent: StrongRef;
}

/**
 * Post embed types
 */
export type PostEmbed =
  | ImagesEmbed
  | ExternalEmbed
  | RecordEmbed
  | RecordWithMediaEmbed
  | VideoEmbed;

export interface ImagesEmbed {
  $type: 'app.bsky.embed.images';
  images: ImageItem[];
}

export interface ImageItem {
  image: BlobRef;
  alt: string;
  aspectRatio?: AspectRatio;
}

export interface AspectRatio {
  width: number;
  height: number;
}

export interface ExternalEmbed {
  $type: 'app.bsky.embed.external';
  external: {
    uri: string;
    title: string;
    description: string;
    thumb?: BlobRef;
  };
}

export interface RecordEmbed {
  $type: 'app.bsky.embed.record';
  record: StrongRef;
}

export interface RecordWithMediaEmbed {
  $type: 'app.bsky.embed.recordWithMedia';
  record: RecordEmbed;
  media: ImagesEmbed | ExternalEmbed | VideoEmbed;
}

export interface VideoEmbed {
  $type: 'app.bsky.embed.video';
  video: BlobRef;
  captions?: BlobRef[];
  alt?: string;
  aspectRatio?: AspectRatio;
}

/**
 * Facet (rich text formatting)
 */
export interface Facet {
  index: {
    byteStart: number;
    byteEnd: number;
  };
  features: FacetFeature[];
}

export type FacetFeature = MentionFeature | LinkFeature | TagFeature;

export interface MentionFeature {
  $type: 'app.bsky.richtext.facet#mention';
  did: string;
}

export interface LinkFeature {
  $type: 'app.bsky.richtext.facet#link';
  uri: string;
}

export interface TagFeature {
  $type: 'app.bsky.richtext.facet#tag';
  tag: string;
}

/**
 * Self-applied labels
 */
export interface SelfLabels {
  $type: 'com.atproto.label.defs#selfLabels';
  values: SelfLabel[];
}

export interface SelfLabel {
  val: string;
}

/**
 * Profile record
 */
export interface ProfileRecord extends AtprotoRecord {
  $type: 'app.bsky.actor.profile';
  displayName?: string;
  description?: string;
  avatar?: BlobRef;
  banner?: BlobRef;
  labels?: SelfLabels;
  createdAt?: string;
  pinnedPost?: StrongRef;
}

/**
 * Follow record
 */
export interface FollowRecord extends AtprotoRecord {
  $type: 'app.bsky.graph.follow';
  subject: string; // DID
  createdAt: string;
}

/**
 * Like record
 */
export interface LikeRecord extends AtprotoRecord {
  $type: 'app.bsky.feed.like';
  subject: StrongRef;
  createdAt: string;
}

/**
 * Repost record
 */
export interface RepostRecord extends AtprotoRecord {
  $type: 'app.bsky.feed.repost';
  subject: StrongRef;
  createdAt: string;
}

/**
 * Block record
 */
export interface BlockRecord extends AtprotoRecord {
  $type: 'app.bsky.graph.block';
  subject: string; // DID
  createdAt: string;
}

/**
 * List record
 */
export interface ListRecord extends AtprotoRecord {
  $type: 'app.bsky.graph.list';
  name: string;
  purpose: ListPurpose;
  description?: string;
  descriptionFacets?: Facet[];
  avatar?: BlobRef;
  labels?: SelfLabels;
  createdAt: string;
}

export type ListPurpose =
  | 'app.bsky.graph.defs#modlist'
  | 'app.bsky.graph.defs#curatelist'
  | 'app.bsky.graph.defs#referencelist';

/**
 * List item record
 */
export interface ListItemRecord extends AtprotoRecord {
  $type: 'app.bsky.graph.listitem';
  subject: string; // DID
  list: string; // AT URI
  createdAt: string;
}

/**
 * Threadgate record
 */
export interface ThreadgateRecord extends AtprotoRecord {
  $type: 'app.bsky.feed.threadgate';
  post: string; // AT URI
  allow?: ThreadgateAllow[];
  createdAt: string;
}

export type ThreadgateAllow = MentionRule | FollowingRule | ListRule;

export interface MentionRule {
  $type: 'app.bsky.feed.threadgate#mentionRule';
}

export interface FollowingRule {
  $type: 'app.bsky.feed.threadgate#followingRule';
}

export interface ListRule {
  $type: 'app.bsky.feed.threadgate#listRule';
  list: string; // AT URI
}

/**
 * Feed generator record
 */
export interface FeedGeneratorRecord extends AtprotoRecord {
  $type: 'app.bsky.feed.generator';
  did: string;
  displayName: string;
  description?: string;
  descriptionFacets?: Facet[];
  avatar?: BlobRef;
  acceptsInteractions?: boolean;
  labels?: SelfLabels;
  createdAt: string;
}

/**
 * Starter pack record
 */
export interface StarterPackRecord extends AtprotoRecord {
  $type: 'app.bsky.graph.starterpack';
  name: string;
  description?: string;
  descriptionFacets?: Facet[];
  list?: string; // AT URI
  feeds?: FeedItem[];
  createdAt: string;
}

export interface FeedItem {
  uri: string; // AT URI of feed generator
}

/**
 * Labeler service record
 */
export interface LabelerRecord extends AtprotoRecord {
  $type: 'app.bsky.labeler.service';
  policies: LabelValueDefinition[];
  labels?: SelfLabels;
  createdAt: string;
}

export interface LabelValueDefinition {
  identifier: string;
  severity: 'inform' | 'alert' | 'none';
  blurs: 'content' | 'media' | 'none';
  defaultSetting?: 'ignore' | 'warn' | 'hide';
  adultOnly?: boolean;
  locales?: LocalizedString[];
}

export interface LocalizedString {
  lang: string;
  name: string;
  description: string;
}
