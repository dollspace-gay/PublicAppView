// Feed types matching Bluesky's implementation
export enum FeedType {
  POSTS_WITH_REPLIES = 'posts_with_replies',
  POSTS_NO_REPLIES = 'posts_no_replies', 
  POSTS_WITH_MEDIA = 'posts_with_media',
  POSTS_AND_AUTHOR_THREADS = 'posts_and_author_threads',
  POSTS_WITH_VIDEO = 'posts_with_video',
}

// Filter to feed type mapping
export const FILTER_TO_FEED_TYPE = {
  posts_with_replies: undefined, // default: all posts, replies, and reposts
  posts_no_replies: FeedType.POSTS_NO_REPLIES,
  posts_with_media: FeedType.POSTS_WITH_MEDIA,
  posts_and_author_threads: FeedType.POSTS_AND_AUTHOR_THREADS,
  posts_with_video: FeedType.POSTS_WITH_VIDEO,
} as const;

// Feed item types
export enum FeedItemType {
  POST = 'post',
  REPOST = 'repost',
  REPLY = 'reply',
}

// Feed item structure
export interface FeedItem {
  post: {
    uri: string;
    cid?: string;
  };
  repost?: {
    uri: string;
    cid?: string;
  };
  authorPinned?: boolean;
}

// Hydration state for feed items
export interface HydrationState {
  posts?: Map<string, any>;
  reposts?: Map<string, any>;
  profileViewers?: Map<string, any>;
  postBlocks?: Map<string, any>;
}

// Profile viewer state
export interface ProfileViewerState {
  blocking?: boolean;
  blockedBy?: boolean;
  following?: boolean;
  followedBy?: boolean;
  blockingByList?: boolean;
  blockedByList?: boolean;
}

// Feed view post structure
export interface FeedViewPost {
  post: any; // PostView
  reason?: {
    $type: 'app.bsky.feed.defs#reasonRepost' | 'app.bsky.feed.defs#reasonPin';
    by: any; // ProfileViewBasic
    indexedAt: string;
  };
  reply?: {
    root: any; // PostView
    parent: any; // PostView
  };
}

// Self-thread tracker for posts_and_author_threads filter
export class SelfThreadTracker {
  feedUris = new Set<string>();
  cache = new Map<string, boolean>();

  constructor(
    items: FeedItem[],
    private hydration: HydrationState,
  ) {
    items.forEach((item) => {
      if (!item.repost) {
        this.feedUris.add(item.post.uri);
      }
    });
  }

  ok(uri: string, loop = new Set<string>()): boolean {
    // if we've already checked this uri, pull from the cache
    if (this.cache.has(uri)) {
      return this.cache.get(uri) ?? false;
    }
    // loop detection
    if (loop.has(uri)) {
      this.cache.set(uri, false);
      return false;
    } else {
      loop.add(uri);
    }
    // cache through the result
    const result = this._ok(uri, loop);
    this.cache.set(uri, result);
    return result;
  }

  private _ok(uri: string, loop: Set<string>): boolean {
    // must be in the feed to be in a self-thread
    if (!this.feedUris.has(uri)) {
      return false;
    }
    // must be hydratable to be part of self-thread
    const post = this.hydration.posts?.get(uri);
    if (!post) {
      return false;
    }
    // root posts (no parent) are trivial case of self-thread
    const parentUri = this.getParentUri(post);
    if (parentUri === null) {
      return true;
    }
    // recurse w/ cache: this post is in a self-thread if its parent is.
    return this.ok(parentUri, loop);
  }

  private getParentUri(post: any): string | null {
    return post.record?.reply?.parent?.uri ?? null;
  }
}