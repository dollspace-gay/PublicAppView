import { HydrationState, FeedItem, FeedViewPost, ProfileViewerState } from '../types/feed';

export class Views {
  feedViewPost(
    item: FeedItem,
    state: HydrationState,
  ): FeedViewPost | undefined {
    const postInfo = state.posts?.get(item.post.uri);
    let reason: any = undefined;
    
    if (item.authorPinned) {
      reason = this.reasonPin();
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

    return {
      uri: postInfo.uri,
      cid: postInfo.cid,
      record: postInfo.record,
      author: postInfo.author,
      replyCount: 0, // TODO: implement reply counting
      repostCount: 0, // TODO: implement repost counting
      likeCount: 0, // TODO: implement like counting
      indexedAt: postInfo.indexedAt,
      viewer: {
        like: undefined, // TODO: implement viewer state
        repost: undefined,
        bookmarked: undefined,
      },
      labels: [], // TODO: implement labels
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

  private reasonPin(): any {
    return {
      $type: 'app.bsky.feed.defs#reasonPin',
      by: undefined, // TODO: implement author info
      indexedAt: new Date().toISOString(),
    };
  }

  private reasonRepost(uri: string, repost: any, state: HydrationState): any | undefined {
    // TODO: implement repost reason with author info
    return {
      $type: 'app.bsky.feed.defs#reasonRepost',
      by: undefined, // TODO: implement reposter info
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