import { HydrationState, FeedItem, FeedViewPost, ProfileViewerState } from '../types/feed';

export class Views {
  /**
   * Transform blob CID to CDN URL (matching xrpc-api pattern)
   */
  private transformBlobToCdnUrl(blobCid: string | null | undefined, userDid: string, format: 'avatar' | 'banner' = 'avatar'): string | undefined {
    if (!blobCid || blobCid === 'undefined') return undefined;
    return `/img/${format}/plain/${userDid}/${blobCid}@jpeg`;
  }

  feedViewPost(
    item: FeedItem,
    state: HydrationState,
  ): FeedViewPost | undefined {
    const postInfo = state.posts?.get(item.post.uri);
    let reason: any = undefined;
    
    if (item.authorPinned) {
      reason = this.reasonPin(postInfo?.author?.did || '', state);
    } else if (item.repost) {
      const repost = state.reposts?.get(item.repost.uri);
      if (!repost) return;
      if (repost.record.subject.uri !== item.post.uri) return;
      reason = this.reasonRepost(item.repost.uri, repost, state);
      if (!reason) return;
    }
    
    const post = this.post(item.post.uri, state);
    if (!post) return;
    
    const reply = !postInfo?.violatesThreadGate
      ? this.replyRef(item.post.uri, state)
      : undefined;
      
    return {
      post,
      reason,
      reply,
    };
  }

  private post(uri: string, state: HydrationState): any | undefined {
    const postInfo = state.posts?.get(uri);
    if (!postInfo) return undefined;

    // Get aggregations and viewer state from the state
    const aggregations = state.aggregations?.get(uri);
    const viewerState = state.viewerStates?.get(uri);

    // Get thread context if available
    const threadContext = state.threadContexts?.get(uri);
    
    return {
      uri: postInfo.uri,
      cid: postInfo.cid,
      record: postInfo.record,
      author: postInfo.author,
      replyCount: aggregations?.replyCount || 0,
      repostCount: aggregations?.repostCount || 0,
      likeCount: aggregations?.likeCount || 0,
      bookmarkCount: aggregations?.bookmarkCount || 0,
      quoteCount: aggregations?.quoteCount || 0,
      indexedAt: postInfo.indexedAt,
      viewer: viewerState ? {
        like: viewerState.likeUri || undefined,
        repost: viewerState.repostUri || undefined,
        bookmarked: viewerState.bookmarked || false,
        threadMuted: viewerState.threadMuted || false,
        replyDisabled: viewerState.replyDisabled || false,
        embeddingDisabled: viewerState.embeddingDisabled || false,
        pinned: viewerState.pinned || false,
      } : {},
      labels: state.labels?.get(uri) || [],
      threadContext: threadContext ? {
        rootAuthorLike: threadContext.rootAuthorLikeUri || undefined,
      } : undefined,
    };
  }

  private replyRef(uri: string, state: HydrationState): any | undefined {
    const postRecord = state.posts?.get(uri)?.record;
    if (!postRecord?.reply) return;

    let root = this.maybePost(postRecord.reply.root?.uri, state);
    let parent = this.maybePost(postRecord.reply.parent?.uri, state);

    return {
      root,
      parent,
    };
  }

  private maybePost(uri: string | undefined, state: HydrationState): any | undefined {
    if (!uri) return undefined;
    return this.post(uri, state);
  }

  private reasonPin(authorDid: string, state: HydrationState): any | undefined {
    // Get the author's profile information for pinned posts
    const authorProfile = state.profileViewers?.get(authorDid);
    
    // Return undefined if author doesn't have a valid handle
    if (!authorProfile || !authorProfile.handle) {
      return undefined;
    }
    
    const avatarUrl = authorProfile.avatarUrl 
      ? this.transformBlobToCdnUrl(authorProfile.avatarUrl, authorDid, 'avatar')
      : undefined;

    // Ensure displayName is always a string
    const displayName = (authorProfile.displayName && typeof authorProfile.displayName === 'string')
      ? authorProfile.displayName
      : authorProfile.handle;
    
    return {
      $type: 'app.bsky.feed.defs#reasonPin',
      by: {
        $type: 'app.bsky.actor.defs#profileViewBasic',
        did: authorDid,
        handle: authorProfile.handle,
        displayName: displayName,
        pronouns: authorProfile.pronouns,
        ...(avatarUrl && { avatar: avatarUrl }),
        associated: {
          $type: 'app.bsky.actor.defs#profileAssociated',
          lists: 0,
          feedgens: 0,
          starterPacks: 0,
          labeler: false,
          chat: undefined,
          activitySubscription: undefined,
        },
        viewer: authorProfile.viewer || {
          $type: 'app.bsky.actor.defs#viewerState',
          muted: false,
          mutedByList: undefined,
          blockedBy: false,
          blocking: undefined,
          blockingByList: undefined,
          following: undefined,
          followedBy: undefined,
          knownFollowers: undefined,
          activitySubscription: undefined,
        },
        labels: [],
        createdAt: authorProfile.createdAt?.toISOString(),
        verification: undefined,
        status: undefined,
      },
      indexedAt: new Date().toISOString(),
    };
  }

  private reasonRepost(uri: string, repost: any, state: HydrationState): any | undefined {
    // Get the reposter's profile information
    const reposterProfile = state.profileViewers?.get(repost.userDid);
    if (!reposterProfile || !reposterProfile.handle) return undefined;
    
    const avatarUrl = reposterProfile.avatarUrl
      ? this.transformBlobToCdnUrl(reposterProfile.avatarUrl, repost.userDid, 'avatar')
      : undefined;

    // Ensure displayName is always a string
    const displayName = (reposterProfile.displayName && typeof reposterProfile.displayName === 'string')
      ? reposterProfile.displayName
      : reposterProfile.handle;

    return {
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: {
        $type: 'app.bsky.actor.defs#profileViewBasic',
        did: repost.userDid,
        handle: reposterProfile.handle,
        displayName: displayName,
        pronouns: reposterProfile.pronouns,
        ...(avatarUrl && { avatar: avatarUrl }),
        associated: {
          $type: 'app.bsky.actor.defs#profileAssociated',
          lists: 0,
          feedgens: 0,
          starterPacks: 0,
          labeler: false,
          chat: undefined,
          activitySubscription: undefined,
        },
        viewer: reposterProfile.viewer || {
          $type: 'app.bsky.actor.defs#viewerState',
          muted: false,
          mutedByList: undefined,
          blockedBy: false,
          blocking: undefined,
          blockingByList: undefined,
          following: undefined,
          followedBy: undefined,
          knownFollowers: undefined,
          activitySubscription: undefined,
        },
        labels: [],
        createdAt: reposterProfile.createdAt?.toISOString(),
        verification: undefined,
        status: undefined,
      },
      uri: uri,
      cid: repost.cid,
      indexedAt: repost.indexedAt,
    };
  }

  feedItemBlocksAndMutes(item: FeedItem, state: HydrationState): {
    authorBlocked: boolean;
    originatorBlocked: boolean;
    authorMuted: boolean;
    originatorMuted: boolean;
  } {
    const postInfo = state.posts?.get(item.post.uri);
    const authorDid = postInfo?.author?.did;
    const originatorDid = item.repost ? 
      state.reposts?.get(item.repost.uri)?.record?.subject?.uri : authorDid;

    const authorViewer = authorDid ? state.profileViewers?.get(authorDid) : undefined;
    const originatorViewer = originatorDid ? state.profileViewers?.get(originatorDid) : undefined;

    return {
      authorBlocked: authorViewer?.blocking || false,
      originatorBlocked: originatorViewer?.blocking || false,
      authorMuted: authorViewer?.muting || false,
      originatorMuted: originatorViewer?.muting || false,
    };
  }

  blockingByList(relationship: ProfileViewerState, state: HydrationState): boolean {
    // TODO: implement list-based blocking
    return false;
  }

  blockedByList(relationship: ProfileViewerState, state: HydrationState): boolean {
    // TODO: implement list-based blocking
    return false;
  }
}