import { db } from '../../../server/db';
import {
  posts,
  postAggregations,
  blocks,
  mutes,
  threadGates,
  listItems,
  follows,
} from '../../../shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import type { PostRecord, ThreadRecord } from '../types';
import { cacheService } from './cache';

/**
 * Thread Assembler Service
 *
 * Assembles post threads with:
 * - Recursive ancestor loading (up to root)
 * - Descendant loading with depth limits
 * - Reply sorting and pruning
 * - Viewer-based filtering (blocks/mutes)
 * - Thread gate enforcement (reply restrictions)
 */

interface ThreadNode {
  post: PostRecord;
  parent?: ThreadNode;
  replies?: ThreadNode[];
  depth: number; // Distance from anchor post (0 = anchor, -1 = parent, -2 = grandparent, etc.)
}

interface AssembleThreadOptions {
  uri: string;
  depth?: number; // How many levels of replies to load (default: 6)
  parentHeight?: number; // How many levels of parents to load (default: 80)
  viewerDid?: string; // For filtering blocked/muted content
}

export class ThreadAssembler {
  /**
   * Load viewer's blocks and mutes for filtering
   * Uses cache to avoid repeated database queries
   */
  private async loadViewerRelationships(viewerDid: string): Promise<{
    blockedDids: Set<string>;
    mutedDids: Set<string>;
  }> {
    // Try to get from cache first
    const [cachedBlocks, cachedMutes] = await Promise.all([
      cacheService.getViewerBlocks(viewerDid),
      cacheService.getViewerMutes(viewerDid),
    ]);

    let blockedDids: Set<string>;
    let mutedDids: Set<string>;

    // If both are in cache, return immediately
    if (cachedBlocks && cachedMutes) {
      return { blockedDids: cachedBlocks, mutedDids: cachedMutes };
    }

    // Load missing data from database
    const [blockedUsers, mutedUsers] = await Promise.all([
      cachedBlocks
        ? Promise.resolve([])
        : db
            .select({ did: blocks.blockedDid })
            .from(blocks)
            .where(eq(blocks.blockerDid, viewerDid)),

      cachedMutes
        ? Promise.resolve([])
        : db
            .select({ did: mutes.mutedDid })
            .from(mutes)
            .where(eq(mutes.muterDid, viewerDid)),
    ]);

    blockedDids = cachedBlocks || new Set(blockedUsers.map((b) => b.did));
    mutedDids = cachedMutes || new Set(mutedUsers.map((m) => m.did));

    // Cache the results
    await Promise.all([
      cachedBlocks
        ? Promise.resolve()
        : cacheService.setViewerBlocks(viewerDid, blockedDids),
      cachedMutes
        ? Promise.resolve()
        : cacheService.setViewerMutes(viewerDid, mutedDids),
    ]);

    return { blockedDids, mutedDids };
  }

  /**
   * Check if a post should be filtered based on viewer relationships
   */
  private shouldFilterPost(
    authorDid: string,
    blockedDids: Set<string>,
    mutedDids: Set<string>
  ): boolean {
    // Filter out posts from blocked users
    if (blockedDids.has(authorDid)) {
      return true;
    }

    // Filter out posts from muted users
    if (mutedDids.has(authorDid)) {
      return true;
    }

    return false;
  }

  /**
   * Load thread gate for a root post URI
   * Uses cache to avoid repeated database queries
   */
  private async loadThreadGate(rootUri: string) {
    // Try to get from cache first
    const cached = await cacheService.getThreadGate(rootUri);
    if (cached !== null) {
      return cached;
    }

    // Load from database
    const gate = await db.query.threadGates.findFirst({
      where: eq(threadGates.postUri, rootUri),
    });

    // Cache the result (including null/undefined to prevent repeated queries)
    await cacheService.setThreadGate(rootUri, gate || null);

    return gate;
  }

  /**
   * Load root author's following list (for thread gate checking)
   * Uses cache to avoid repeated database queries
   */
  private async loadRootAuthorFollowing(
    rootAuthorDid: string
  ): Promise<Set<string>> {
    // Try to get from cache first
    const cached = await cacheService.getUserFollowing(rootAuthorDid);
    if (cached) {
      return cached;
    }

    // Load from database
    const following = await db
      .select({ did: follows.followingDid })
      .from(follows)
      .where(eq(follows.followerDid, rootAuthorDid));

    const followingSet = new Set(following.map((f) => f.did));

    // Cache the result
    await cacheService.setUserFollowing(rootAuthorDid, followingSet);

    return followingSet;
  }

  /**
   * Load list members for allowed lists (for thread gate checking)
   * Uses cache to avoid repeated database queries
   */
  private async loadListMembers(listUris: string[]): Promise<Set<string>> {
    if (listUris.length === 0) {
      return new Set();
    }

    // Try to load each list from cache
    const cacheResults = await Promise.all(
      listUris.map((uri) => cacheService.getListMembers(uri))
    );

    // Check if all lists are cached
    const allCached = cacheResults.every((result) => result !== null);

    if (allCached) {
      // Combine all cached sets
      const combined = new Set<string>();
      cacheResults.forEach((set) => {
        if (set) {
          set.forEach((did) => combined.add(did));
        }
      });
      return combined;
    }

    // Load from database (for simplicity, load all lists even if some are cached)
    const members = await db
      .select({ did: listItems.subjectDid, listUri: listItems.listUri })
      .from(listItems)
      .where(inArray(listItems.listUri, listUris));

    // Group members by list for caching
    const membersByList = new Map<string, Set<string>>();
    for (const member of members) {
      if (!membersByList.has(member.listUri)) {
        membersByList.set(member.listUri, new Set());
      }
      membersByList.get(member.listUri)!.add(member.did);
    }

    // Cache each list
    await Promise.all(
      listUris.map((uri) => {
        const membersSet = membersByList.get(uri) || new Set<string>();
        return cacheService.setListMembers(uri, membersSet);
      })
    );

    // Return combined set
    const combined = new Set<string>();
    membersByList.forEach((set) => {
      set.forEach((did) => combined.add(did));
    });

    return combined;
  }

  /**
   * Extract mentioned DIDs from post facets
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getMentionedDids(facets: any): string[] {
    if (!facets?.features) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mentions = facets.features.filter(
      (f: any) => f.$type === 'app.bsky.richtext.facet#mention'
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return mentions.map((m: any) => m.did);
  }

  /**
   * Check if a reply violates a thread gate
   * Returns true if the reply should be filtered out
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private checkThreadGateViolation(
    replyAuthorDid: string,
    rootAuthorDid: string,
    threadGate: any,
    mentionedDids: string[],
    rootAuthorFollowing: Set<string>,
    allowedListMembers: Set<string>
  ): boolean {
    if (!threadGate) {
      return false; // No thread gate, allow the reply
    }

    // Root author can always reply to their own thread
    if (replyAuthorDid === rootAuthorDid) {
      return false;
    }

    // Check allowMentions - if true, anyone mentioned in root post can reply
    if (threadGate.allowMentions && mentionedDids.includes(replyAuthorDid)) {
      return false;
    }

    // Check allowFollowing - if true, users followed by root author can reply
    if (threadGate.allowFollowing && rootAuthorFollowing.has(replyAuthorDid)) {
      return false;
    }

    // Check allowListMembers - if true, check if reply author is in any of the allowed lists
    if (threadGate.allowListMembers && allowedListMembers.has(replyAuthorDid)) {
      return false;
    }

    // If we get here, the reply violates the thread gate
    return true;
  }

  /**
   * Assemble a thread for a given post URI
   */
  async assembleThread(
    options: AssembleThreadOptions
  ): Promise<ThreadRecord | null> {
    const { uri, depth = 6, parentHeight = 80, viewerDid } = options;

    // 0. Check cache for fully assembled thread
    const cachedThread = await cacheService.getThread(
      uri,
      depth,
      parentHeight,
      viewerDid
    );
    if (cachedThread) {
      return cachedThread;
    }

    // 1. Load viewer relationships if viewerDid provided
    let viewerRelationships:
      | { blockedDids: Set<string>; mutedDids: Set<string> }
      | undefined;
    if (viewerDid) {
      viewerRelationships = await this.loadViewerRelationships(viewerDid);
    }

    // 2. Load the anchor post
    const anchorPost = await this.loadPost(uri);
    if (!anchorPost) {
      return null;
    }

    // 3. Build ancestor chain (parent, grandparent, etc. up to root)
    const ancestors = await this.loadAncestors(
      anchorPost,
      parentHeight,
      viewerRelationships
    );

    // 4. Determine root post for thread gate checking
    const rootPost =
      ancestors.length > 0 ? ancestors[ancestors.length - 1] : anchorPost;
    const rootUri = rootPost.post.uri;

    // 5. Load thread gate data (if exists)
    const threadGate = await this.loadThreadGate(rootUri);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let threadGateContext:
      | {
          threadGate: any;
          mentionedDids: string[];
          rootAuthorFollowing: Set<string>;
          allowedListMembers: Set<string>;
        }
      | undefined;

    if (threadGate) {
      // Load data needed for thread gate enforcement in parallel
      const [rootAuthorFollowing, allowedListMembers] = await Promise.all([
        threadGate.allowFollowing
          ? this.loadRootAuthorFollowing(rootPost.post.authorDid)
          : Promise.resolve(new Set<string>()),
        threadGate.allowListMembers && threadGate.allowListUris
          ? this.loadListMembers(threadGate.allowListUris as string[])
          : Promise.resolve(new Set<string>()),
      ]);

      threadGateContext = {
        threadGate,
        mentionedDids: this.getMentionedDids(rootPost.post.facets),
        rootAuthorFollowing,
        allowedListMembers,
      };
    }

    // 6. Build descendant tree (replies, nested replies, etc.)
    const anchorWithReplies = await this.loadDescendants(
      anchorPost,
      depth,
      viewerRelationships,
      threadGateContext,
      rootPost.post.authorDid
    );

    // 7. Assemble the full tree
    // Start from the root (topmost ancestor) and build down
    let rootNode: ThreadNode;

    if (ancestors.length > 0) {
      // We have ancestors - build from root down to anchor
      rootNode = ancestors[ancestors.length - 1]; // Root is last in ancestor chain

      // Link ancestors together
      for (let i = ancestors.length - 1; i > 0; i--) {
        ancestors[i].replies = [ancestors[i - 1]];
      }

      // Link anchor to last ancestor
      ancestors[0].replies = [anchorWithReplies];
      anchorWithReplies.parent = ancestors[0];
    } else {
      // No ancestors - anchor is the root
      rootNode = anchorWithReplies;
    }

    // 8. Convert ThreadNode tree to ThreadRecord format
    const threadRecord = this.nodeToRecord(rootNode);

    // 9. Cache the assembled thread
    await cacheService.setThread(
      uri,
      depth,
      parentHeight,
      viewerDid,
      threadRecord
    );

    return threadRecord;
  }

  /**
   * Load a single post with aggregations
   */
  private async loadPost(uri: string): Promise<ThreadNode | null> {
    const result = await db
      .select()
      .from(posts)
      .leftJoin(postAggregations, eq(posts.uri, postAggregations.postUri))
      .where(eq(posts.uri, uri))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const p = result[0];

    return {
      post: {
        uri: p.posts.uri,
        cid: p.posts.cid,
        authorDid: p.posts.authorDid,
        text: p.posts.text,
        parentUri: p.posts.parentUri || undefined,
        rootUri: p.posts.rootUri || undefined,
        embed: p.posts.embed,
        facets: p.posts.facets,
        likeCount: p.post_aggregations?.likeCount || 0,
        repostCount: p.post_aggregations?.repostCount || 0,
        replyCount: p.post_aggregations?.replyCount || 0,
        quoteCount: p.post_aggregations?.quoteCount || 0,
        indexedAt: p.posts.indexedAt.toISOString(),
        createdAt: p.posts.createdAt.toISOString(),
      },
      depth: 0,
    };
  }

  /**
   * Load ancestor chain (parent, grandparent, etc.)
   * Returns array with immediate parent first, root last
   * Filters out blocked/muted users if viewer relationships provided
   */
  private async loadAncestors(
    anchorPost: ThreadNode,
    maxHeight: number,
    viewerRelationships?: { blockedDids: Set<string>; mutedDids: Set<string> }
  ): Promise<ThreadNode[]> {
    const ancestors: ThreadNode[] = [];

    let currentUri = anchorPost.post.parentUri;
    let currentDepth = -1; // Parents have negative depth

    while (currentUri && ancestors.length < maxHeight) {
      const parent = await this.loadPost(currentUri);
      if (!parent) {
        // Parent not found - stop here
        break;
      }

      // Filter blocked/muted users from ancestor chain
      if (
        viewerRelationships &&
        this.shouldFilterPost(
          parent.post.authorDid,
          viewerRelationships.blockedDids,
          viewerRelationships.mutedDids
        )
      ) {
        // Skip this ancestor but continue up the chain
        currentUri = parent.post.parentUri;
        currentDepth--;
        continue;
      }

      parent.depth = currentDepth;
      ancestors.push(parent);

      // Move to next parent
      currentUri = parent.post.parentUri;
      currentDepth--;
    }

    return ancestors;
  }

  /**
   * Load descendants (replies) recursively with depth limit
   * Filters out blocked/muted users if viewer relationships provided
   * Filters out replies that violate thread gates
   */
  private async loadDescendants(
    post: ThreadNode,
    maxDepth: number,
    viewerRelationships?: { blockedDids: Set<string>; mutedDids: Set<string> },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    threadGateContext?: {
      threadGate: any;
      mentionedDids: string[];
      rootAuthorFollowing: Set<string>;
      allowedListMembers: Set<string>;
    },
    rootAuthorDid?: string,
    currentDepth: number = 0
  ): Promise<ThreadNode> {
    // Base case: reached max depth
    if (currentDepth >= maxDepth) {
      return post;
    }

    // Load direct replies to this post
    const replyResults = await db
      .select()
      .from(posts)
      .leftJoin(postAggregations, eq(posts.uri, postAggregations.postUri))
      .where(eq(posts.parentUri, post.post.uri))
      .orderBy(sql`${posts.createdAt} DESC`) // Newest first
      .limit(100); // Limit replies per level

    if (replyResults.length === 0) {
      return post;
    }

    // Convert to ThreadNodes and filter blocked/muted users and thread gate violations
    const replyNodes: ThreadNode[] = replyResults
      .map((r) => ({
        post: {
          uri: r.posts.uri,
          cid: r.posts.cid,
          authorDid: r.posts.authorDid,
          text: r.posts.text,
          parentUri: r.posts.parentUri || undefined,
          rootUri: r.posts.rootUri || undefined,
          embed: r.posts.embed,
          facets: r.posts.facets,
          likeCount: r.post_aggregations?.likeCount || 0,
          repostCount: r.post_aggregations?.repostCount || 0,
          replyCount: r.post_aggregations?.replyCount || 0,
          quoteCount: r.post_aggregations?.quoteCount || 0,
          indexedAt: r.posts.indexedAt.toISOString(),
          createdAt: r.posts.createdAt.toISOString(),
        },
        parent: post,
        depth: currentDepth + 1,
      }))
      .filter((reply) => {
        // Filter out blocked/muted users
        if (
          viewerRelationships &&
          this.shouldFilterPost(
            reply.post.authorDid,
            viewerRelationships.blockedDids,
            viewerRelationships.mutedDids
          )
        ) {
          return false;
        }

        // Filter out thread gate violations
        if (threadGateContext && rootAuthorDid) {
          const violatesGate = this.checkThreadGateViolation(
            reply.post.authorDid,
            rootAuthorDid,
            threadGateContext.threadGate,
            threadGateContext.mentionedDids,
            threadGateContext.rootAuthorFollowing,
            threadGateContext.allowedListMembers
          );
          if (violatesGate) {
            return false;
          }
        }

        return true;
      });

    // Recursively load replies for each reply
    const replyNodesWithDescendants = await Promise.all(
      replyNodes.map((reply) =>
        this.loadDescendants(
          reply,
          maxDepth,
          viewerRelationships,
          threadGateContext,
          rootAuthorDid,
          currentDepth + 1
        )
      )
    );

    // Apply sorting and filtering
    const sortedReplies = this.sortReplies(
      replyNodesWithDescendants,
      post.post.authorDid
    );

    // Apply branching factor (limit replies per level)
    const branchingFactor = 10; // Configurable
    const trimmedReplies =
      currentDepth === 0
        ? sortedReplies // Don't trim anchor's direct replies
        : sortedReplies.slice(0, branchingFactor);

    post.replies = trimmedReplies.length > 0 ? trimmedReplies : undefined;

    return post;
  }

  /**
   * Sort replies with intelligent ordering
   * - OP replies first
   * - Then by engagement (likes + reposts)
   * - Then by recency
   */
  private sortReplies(replies: ThreadNode[], opDid: string): ThreadNode[] {
    return replies.sort((a, b) => {
      // 1. Prioritize OP replies
      const aIsOP = a.post.authorDid === opDid;
      const bIsOP = b.post.authorDid === opDid;

      if (aIsOP && !bIsOP) return -1;
      if (!aIsOP && bIsOP) return 1;

      // 2. Sort by engagement (likes + reposts)
      const aEngagement = a.post.likeCount + a.post.repostCount;
      const bEngagement = b.post.likeCount + b.post.repostCount;

      if (aEngagement !== bEngagement) {
        return bEngagement - aEngagement; // Higher engagement first
      }

      // 3. Sort by recency (newer first)
      const aTime = new Date(a.post.createdAt).getTime();
      const bTime = new Date(b.post.createdAt).getTime();

      return bTime - aTime;
    });
  }

  /**
   * Convert ThreadNode tree to ThreadRecord format
   */
  private nodeToRecord(node: ThreadNode): ThreadRecord {
    const record: ThreadRecord = {
      post: node.post,
    };

    if (node.parent) {
      record.parent = this.nodeToRecord(node.parent);
    }

    if (node.replies && node.replies.length > 0) {
      record.replies = node.replies.map((reply) => this.nodeToRecord(reply));
    }

    return record;
  }

  /**
   * Get thread context for a post (for displaying in feeds)
   * Returns just the immediate parent and root author info
   */
  async getThreadContext(uri: string): Promise<{
    hasParent: boolean;
    rootAuthorDid?: string;
    parentAuthorDid?: string;
  } | null> {
    const post = await db.query.posts.findFirst({
      where: eq(posts.uri, uri),
    });

    if (!post) {
      return null;
    }

    const context: {
      hasParent: boolean;
      rootAuthorDid?: string;
      parentAuthorDid?: string;
    } = {
      hasParent: !!post.parentUri,
    };

    if (post.rootUri) {
      const rootPost = await db.query.posts.findFirst({
        where: eq(posts.uri, post.rootUri),
      });
      if (rootPost) {
        context.rootAuthorDid = rootPost.authorDid;
      }
    }

    if (post.parentUri) {
      const parentPost = await db.query.posts.findFirst({
        where: eq(posts.uri, post.parentUri),
      });
      if (parentPost) {
        context.parentAuthorDid = parentPost.authorDid;
      }
    }

    return context;
  }

  /**
   * Count total replies in a thread (for reply count badges)
   */
  async countThreadReplies(uri: string, maxDepth: number = 3): Promise<number> {
    // Recursive CTE to count all descendants
    const result = await db.execute<{ count: string }>(sql`
      WITH RECURSIVE thread_replies AS (
        -- Anchor: direct replies
        SELECT uri, parent_uri, 1 as depth
        FROM posts
        WHERE parent_uri = ${uri}

        UNION ALL

        -- Recursive: replies to replies
        SELECT p.uri, p.parent_uri, tr.depth + 1
        FROM posts p
        INNER JOIN thread_replies tr ON p.parent_uri = tr.uri
        WHERE tr.depth < ${maxDepth}
      )
      SELECT COUNT(*)::text as count FROM thread_replies
    `);

    return parseInt(result.rows[0]?.count || '0', 10);
  }
}

// Singleton instance
export const threadAssembler = new ThreadAssembler();
