import { storage } from "../storage";
import { lexiconValidator } from "./lexicon-validator";
import { labelService } from "./label";
import type { InsertUser, InsertPost, InsertLike, InsertRepost, InsertFollow, InsertBlock, InsertList, InsertListItem, InsertFeedGenerator, InsertStarterPack, InsertLabelerService } from "@shared/schema";

function sanitizeText(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  return text.replace(/\u0000/g, '');
}

function sanitizeRequiredText(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(/\u0000/g, '');
}

interface PendingOp {
  type: 'like' | 'repost';
  payload: InsertLike | InsertRepost;
  enqueuedAt: number;
}

interface PendingListItem {
  payload: InsertListItem;
  enqueuedAt: number;
}

export class EventProcessor {
  private pendingOps: Map<string, PendingOp[]> = new Map();
  private pendingOpIndex: Map<string, string> = new Map(); // opUri -> postUri
  private pendingListItems: Map<string, PendingListItem[]> = new Map(); // listUri -> pending list items
  private pendingListItemIndex: Map<string, string> = new Map(); // itemUri -> listUri
  private readonly TTL_MS = 10 * 60 * 1000; // 10 minute TTL for cleanup
  private totalPendingCount = 0; // Running counter for performance
  private totalPendingListItems = 0; // Counter for pending list items
  private metrics = {
    pendingQueued: 0,
    pendingFlushed: 0,
    pendingExpired: 0,
    pendingDropped: 0,
    pendingListItemsQueued: 0,
    pendingListItemsFlushed: 0,
    pendingListItemsExpired: 0,
    pendingListItemsDropped: 0,
  };

  constructor() {
    this.startTTLSweeper();
  }

  private startTTLSweeper() {
    setInterval(() => {
      this.sweepExpiredOps();
    }, 60000); // Run every minute
  }

  private sweepExpiredOps() {
    const now = Date.now();
    let expired = 0;
    let expiredListItems = 0;

    // Sweep pending likes/reposts
    for (const [postUri, ops] of Array.from(this.pendingOps.entries())) {
      const validOps = ops.filter((op: PendingOp) => {
        if (now - op.enqueuedAt > this.TTL_MS) {
          expired++;
          // Remove from index
          const opUri = op.payload.uri;
          this.pendingOpIndex.delete(opUri);
          return false;
        }
        return true;
      });

      if (validOps.length === 0) {
        this.pendingOps.delete(postUri);
      } else if (validOps.length < ops.length) {
        this.pendingOps.set(postUri, validOps);
      }
    }

    // Sweep pending list items
    for (const [listUri, items] of Array.from(this.pendingListItems.entries())) {
      const validItems = items.filter((item: PendingListItem) => {
        if (now - item.enqueuedAt > this.TTL_MS) {
          expiredListItems++;
          // Remove from index
          this.pendingListItemIndex.delete(item.payload.uri);
          return false;
        }
        return true;
      });

      if (validItems.length === 0) {
        this.pendingListItems.delete(listUri);
      } else if (validItems.length < items.length) {
        this.pendingListItems.set(listUri, validItems);
      }
    }

    if (expired > 0) {
      this.totalPendingCount -= expired;
      this.metrics.pendingExpired += expired;
      // Only log if significant (>10k to reduce noise under heavy load)
      if (expired > 10000) {
        console.log(`[EVENT_PROCESSOR] Expired ${expired} pending operations (TTL exceeded, database overload)`);
      }
    }

    if (expiredListItems > 0) {
      this.totalPendingListItems -= expiredListItems;
      this.metrics.pendingListItemsExpired += expiredListItems;
      // Only log if significant (>100 to reduce noise)
      if (expiredListItems > 100) {
        console.log(`[EVENT_PROCESSOR] Expired ${expiredListItems} pending list items (TTL exceeded)`);
      }
    }
  }

  private enqueuePending(postUri: string, op: PendingOp) {
    const opUri = op.payload.uri;
    
    // Check for duplicates
    if (this.pendingOpIndex.has(opUri)) {
      return; // Already pending, skip
    }

    // Get or create queue for this post (no limits)
    const queue = this.pendingOps.get(postUri) || [];
    
    queue.push(op);
    this.pendingOps.set(postUri, queue);
    
    // Add to index
    this.pendingOpIndex.set(opUri, postUri);
    
    this.totalPendingCount++;
    this.metrics.pendingQueued++;
  }

  private async flushPending(postUri: string) {
    // Atomically remove queue before processing to avoid race conditions
    const ops = this.pendingOps.get(postUri);
    if (!ops || ops.length === 0) {
      return;
    }
    
    // Delete immediately to prevent new ops from being lost
    this.pendingOps.delete(postUri);

    console.log(`[EVENT_PROCESSOR] Flushing ${ops.length} pending operations for ${postUri}`);

    for (const op of ops) {
      try {
        if (op.type === 'like') {
          await storage.createLike(op.payload as InsertLike);
          this.metrics.pendingFlushed++;
        } else if (op.type === 'repost') {
          await storage.createRepost(op.payload as InsertRepost);
          this.metrics.pendingFlushed++;
        }
        
        // Remove from index
        const opUri = op.payload.uri;
        this.pendingOpIndex.delete(opUri);
        this.totalPendingCount--;
      } catch (error: any) {
        // If still failing, skip it
        console.error(`[EVENT_PROCESSOR] Error flushing pending ${op.type}:`, error.message);
        // Still remove from index and count
        const opUri = op.payload.uri;
        this.pendingOpIndex.delete(opUri);
        this.totalPendingCount--;
      }
    }
  }

  private cancelPendingOp(opUri: string) {
    // Find and remove pending op from queue
    const postUri = this.pendingOpIndex.get(opUri);
    if (!postUri) {
      return; // Not pending
    }

    const queue = this.pendingOps.get(postUri);
    if (!queue) {
      return;
    }

    // Filter out the op and count removed
    const filteredQueue = queue.filter(op => op.payload.uri !== opUri);
    const removed = queue.length - filteredQueue.length;
    
    if (filteredQueue.length === 0) {
      this.pendingOps.delete(postUri);
    } else if (removed > 0) {
      this.pendingOps.set(postUri, filteredQueue);
    }
    
    // Update count and index
    if (removed > 0) {
      this.totalPendingCount -= removed;
      this.pendingOpIndex.delete(opUri);
    }
  }

  private enqueuePendingListItem(listUri: string, item: PendingListItem) {
    const itemUri = item.payload.uri;
    
    // Check for duplicates
    if (this.pendingListItemIndex.has(itemUri)) {
      return; // Already pending, skip
    }

    // Get or create queue for this list (no limits)
    const queue = this.pendingListItems.get(listUri) || [];
    
    queue.push(item);
    this.pendingListItems.set(listUri, queue);
    
    // Add to index
    this.pendingListItemIndex.set(itemUri, listUri);
    
    this.totalPendingListItems++;
    this.metrics.pendingListItemsQueued++;
  }

  private async flushPendingListItems(listUri: string) {
    // Atomically remove queue before processing to avoid race conditions
    const items = this.pendingListItems.get(listUri);
    if (!items || items.length === 0) {
      return;
    }
    
    // Delete immediately to prevent new items from being lost
    this.pendingListItems.delete(listUri);

    console.log(`[EVENT_PROCESSOR] Flushing ${items.length} pending list items for ${listUri}`);

    for (const item of items) {
      try {
        await storage.createListItem(item.payload);
        this.metrics.pendingListItemsFlushed++;
        
        // Remove from index
        this.pendingListItemIndex.delete(item.payload.uri);
        this.totalPendingListItems--;
      } catch (error: any) {
        // If still failing, skip it
        console.error(`[EVENT_PROCESSOR] Error flushing pending list item:`, error.message);
        // Still remove from index and count
        this.pendingListItemIndex.delete(item.payload.uri);
        this.totalPendingListItems--;
      }
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      pendingCount: this.totalPendingCount,
    };
  }

  private async ensureUser(did: string): Promise<boolean> {
    try {
      const user = await storage.getUser(did);
      if (!user) {
        await storage.createUser({
          did,
          handle: did,
        });
      }
      return true;
    } catch (error: any) {
      // Ignore unique constraint violations (user already exists from parallel insert)
      if (error.code === '23505') {
        return true;
      }
      console.error(`[EVENT_PROCESSOR] Error ensuring user ${did}:`, error);
      return false;
    }
  }

  async processCommit(event: any) {
    const { repo, ops } = event;

    for (const op of ops) {
      const { action, path, cid } = op;
      const collection = path.split("/")[0];
      const uri = `at://${repo}/${path}`;

      try {
        if (action === "create" || action === "update") {
          const record = op.record;
          const recordType = record.$type;

          // Validate record
          if (!lexiconValidator.validate(recordType, record)) {
            console.log(`[VALIDATOR] Invalid record: ${recordType} at ${uri}`);
            continue;
          }

          switch (recordType) {
            case "app.bsky.feed.post":
              await this.processPost(uri, cid, repo, record);
              break;
            case "app.bsky.feed.like":
              await this.processLike(uri, repo, record);
              break;
            case "app.bsky.feed.repost":
              await this.processRepost(uri, repo, record);
              break;
            case "app.bsky.actor.profile":
              await this.processProfile(repo, record);
              break;
            case "app.bsky.graph.follow":
              await this.processFollow(uri, repo, record);
              break;
            case "app.bsky.graph.block":
              await this.processBlock(uri, repo, record);
              break;
            case "app.bsky.graph.list":
              await this.processList(uri, cid, repo, record);
              break;
            case "app.bsky.graph.listitem":
              await this.processListItem(uri, cid, repo, record);
              break;
            case "app.bsky.feed.generator":
              await this.processFeedGenerator(uri, cid, repo, record);
              break;
            case "app.bsky.graph.starterpack":
              await this.processStarterPack(uri, cid, repo, record);
              break;
            case "app.bsky.labeler.service":
              await this.processLabelerService(uri, cid, repo, record);
              break;
            case "com.atproto.label.label":
              await this.processLabel(uri, repo, record);
              break;
          }
        } else if (action === "delete") {
          await this.processDelete(uri, collection);
        }
      } catch (error: any) {
        // Handle duplicate key errors gracefully (common during firehose reconnections)
        if (error?.code === '23505') {
          console.log(`[EVENT_PROCESSOR] Skipped duplicate ${action} ${uri}`);
        } 
        // Handle foreign key constraint violations (record references missing data)
        else if (error?.code === '23503') {
          console.log(`[EVENT_PROCESSOR] Skipped ${action} ${uri} - referenced record not yet indexed (${error.constraint || 'unknown constraint'})`);
        } 
        else {
          console.error(`[EVENT_PROCESSOR] Error processing ${action} ${uri}:`, error);
        }
      }
    }
  }

  async processIdentity(event: any) {
    const { did, handle } = event;
    
    try {
      const existingUser = await storage.getUser(did);
      if (existingUser) {
        await storage.updateUser(did, { handle });
        console.log(`[IDENTITY] Updated handle for ${did} to ${handle}`);
      }
    } catch (error: any) {
      if (error?.code === '23505') {
        console.log(`[EVENT_PROCESSOR] Skipped duplicate identity update for ${did}`);
      } else {
        console.error(`[EVENT_PROCESSOR] Error processing identity:`, error);
      }
    }
  }

  async processAccount(event: any) {
    const { did, active } = event;
    console.log(`[ACCOUNT] Account status change: ${did} - active: ${active}`);
  }

  private async processPost(uri: string, cid: string, authorDid: string, record: any) {
    const authorReady = await this.ensureUser(authorDid);
    if (!authorReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping post ${uri} - author not ready`);
      return;
    }

    const post: InsertPost = {
      uri,
      cid,
      authorDid,
      text: sanitizeRequiredText(record.text),
      parentUri: record.reply?.parent.uri,
      rootUri: record.reply?.root.uri,
      embed: record.embed,
      createdAt: new Date(record.createdAt),
    };

    await storage.createPost(post);
    
    // Create notification for reply
    if (record.reply?.parent.uri) {
      try {
        const parentPost = await storage.getPost(record.reply.parent.uri);
        if (parentPost && parentPost.authorDid !== authorDid) {
          await storage.createNotification({
            uri: `${uri}/notification/reply`,
            recipientDid: parentPost.authorDid,
            authorDid,
            reason: 'reply',
            reasonSubject: uri,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        }
      } catch (error) {
        console.error(`[NOTIFICATION] Error creating reply notification:`, error);
      }
    }

    // Check for mentions in text
    try {
      const mentions = record.text?.match(/@([a-zA-Z0-9.-]+)/g) || [];
      const processedMentions = new Set<string>();
      
      for (const mention of mentions) {
        const handle = mention.substring(1);
        
        // Skip if we've already processed this handle in this post
        if (processedMentions.has(handle)) {
          continue;
        }
        
        const mentionedUser = await storage.getUserByHandle(handle);
        if (mentionedUser && mentionedUser.did !== authorDid) {
          await storage.createNotification({
            uri: `${uri}/notification/mention/${mentionedUser.did}`,
            recipientDid: mentionedUser.did,
            authorDid,
            reason: 'mention',
            reasonSubject: uri,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
          processedMentions.add(handle);
        }
      }
    } catch (error) {
      console.error(`[NOTIFICATION] Error creating mention notifications:`, error);
    }
    
    // Flush any pending operations for this post
    await this.flushPending(uri);
  }

  private async processLike(uri: string, userDid: string, record: any) {
    const userReady = await this.ensureUser(userDid);
    if (!userReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping like ${uri} - user not ready`);
      return;
    }

    const postUri = record.subject.uri;
    const like: InsertLike = {
      uri,
      userDid,
      postUri,
      createdAt: new Date(record.createdAt),
    };

    // Check if post exists
    const post = await storage.getPost(postUri);
    if (!post) {
      // Enqueue for later
      this.enqueuePending(postUri, {
        type: 'like',
        payload: like,
        enqueuedAt: Date.now(),
      });
      return;
    }

    // Post exists, try to create like
    try {
      await storage.createLike(like);
      
      // Create notification for like
      if (post.authorDid !== userDid) {
        try {
          await storage.createNotification({
            uri: `${uri}/notification`,
            recipientDid: post.authorDid,
            authorDid: userDid,
            reason: 'like',
            reasonSubject: postUri,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        } catch (error) {
          console.error(`[NOTIFICATION] Error creating like notification:`, error);
        }
      }
    } catch (error: any) {
      // Check if it's a FK constraint error (race condition)
      if (error.code === '23503') {
        this.enqueuePending(postUri, {
          type: 'like',
          payload: like,
          enqueuedAt: Date.now(),
        });
      } else {
        throw error;
      }
    }
  }

  private async processRepost(uri: string, userDid: string, record: any) {
    const userReady = await this.ensureUser(userDid);
    if (!userReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping repost ${uri} - user not ready`);
      return;
    }

    const postUri = record.subject.uri;
    const repost: InsertRepost = {
      uri,
      userDid,
      postUri,
      createdAt: new Date(record.createdAt),
    };

    // Check if post exists
    const post = await storage.getPost(postUri);
    if (!post) {
      // Enqueue for later
      this.enqueuePending(postUri, {
        type: 'repost',
        payload: repost,
        enqueuedAt: Date.now(),
      });
      return;
    }

    // Post exists, try to create repost
    try {
      await storage.createRepost(repost);
      
      // Create notification for repost
      if (post.authorDid !== userDid) {
        try {
          await storage.createNotification({
            uri: `${uri}/notification`,
            recipientDid: post.authorDid,
            authorDid: userDid,
            reason: 'repost',
            reasonSubject: postUri,
            isRead: false,
            createdAt: new Date(record.createdAt),
          });
        } catch (error) {
          console.error(`[NOTIFICATION] Error creating repost notification:`, error);
        }
      }
    } catch (error: any) {
      // Check if it's a FK constraint error (race condition)
      if (error.code === '23503') {
        this.enqueuePending(postUri, {
          type: 'repost',
          payload: repost,
          enqueuedAt: Date.now(),
        });
      } else {
        throw error;
      }
    }
  }

  private async processProfile(did: string, record: any) {
    await storage.createUser({
      did,
      handle: did,
      displayName: sanitizeText(record.displayName),
      description: sanitizeText(record.description),
      avatarUrl: record.avatar?.ref?.$link,
    });
  }

  private async processFollow(uri: string, followerDid: string, record: any) {
    const followerReady = await this.ensureUser(followerDid);
    const followingReady = await this.ensureUser(record.subject);

    if (!followerReady || !followingReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping follow ${uri} - users not ready`);
      return;
    }

    const follow: InsertFollow = {
      uri,
      followerDid,
      followingDid: record.subject,
      createdAt: new Date(record.createdAt),
    };

    try {
      await storage.createFollow(follow);
    } catch (error: any) {
      // Handle foreign key constraint violations gracefully
      if (error.code === '23503') {
        console.warn(`[EVENT_PROCESSOR] Foreign key violation for follow ${uri} - will retry later`);
        return;
      }
      throw error;
    }
    
    // Create notification for follow
    try {
      await storage.createNotification({
        uri: `${uri}/notification`,
        recipientDid: record.subject,
        authorDid: followerDid,
        reason: 'follow',
        reasonSubject: undefined,
        isRead: false,
        createdAt: new Date(record.createdAt),
      });
    } catch (error) {
      console.error(`[NOTIFICATION] Error creating follow notification:`, error);
    }
  }

  private async processBlock(uri: string, blockerDid: string, record: any) {
    const blockerReady = await this.ensureUser(blockerDid);
    const blockedReady = await this.ensureUser(record.subject);

    if (!blockerReady || !blockedReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping block ${uri} - users not ready`);
      return;
    }

    const block: InsertBlock = {
      uri,
      blockerDid,
      blockedDid: record.subject,
      createdAt: new Date(record.createdAt),
    };

    try {
      await storage.createBlock(block);
    } catch (error: any) {
      // Handle foreign key constraint violations gracefully
      if (error.code === '23503') {
        console.warn(`[EVENT_PROCESSOR] Foreign key violation for block ${uri} - will retry later`);
        return;
      }
      throw error;
    }
  }

  private async processList(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping list ${uri} - creator not ready`);
      return;
    }

    const list: InsertList = {
      uri,
      cid,
      creatorDid,
      name: sanitizeRequiredText(record.name),
      purpose: record.purpose,
      description: sanitizeText(record.description),
      avatarUrl: record.avatar?.ref?.$link,
      createdAt: new Date(record.createdAt),
    };

    await storage.createList(list);
    
    // Flush any pending list items that were waiting for this list
    await this.flushPendingListItems(uri);
  }

  private async processListItem(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    const subjectReady = await this.ensureUser(record.subject);
    
    if (!creatorReady || !subjectReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping list item ${uri} - users not ready`);
      return;
    }

    const listItem: InsertListItem = {
      uri,
      cid,
      listUri: record.list,
      subjectDid: record.subject,
      createdAt: new Date(record.createdAt),
    };

    // Check if parent list exists before attempting insert (prevents FK errors in logs)
    const parentList = await storage.getList(record.list);
    if (!parentList) {
      // Queue the list item to be processed when the list arrives
      this.enqueuePendingListItem(record.list, {
        payload: listItem,
        enqueuedAt: Date.now(),
      });
      return;
    }

    try {
      await storage.createListItem(listItem);
    } catch (error: any) {
      // Fallback: if FK error still happens (race condition), queue it
      if (error.code === '23503') {
        this.enqueuePendingListItem(record.list, {
          payload: listItem,
          enqueuedAt: Date.now(),
        });
      } else {
        throw error;
      }
    }
  }

  private async processLabel(uri: string, src: string, record: any) {
    try {
      await labelService.applyLabel({
        src,
        subject: record.uri || record.did,
        val: record.val,
        neg: record.neg || false,
        createdAt: new Date(record.cid ? record.createdAt : Date.now()),
      });
      console.log(`[LABEL] Applied label ${record.val} to ${record.uri || record.did} from ${src}`);
    } catch (error: any) {
      if (error?.code === '23505') {
        console.log(`[EVENT_PROCESSOR] Skipped duplicate label ${record.val} for ${record.uri || record.did}`);
      } else {
        console.error(`[EVENT_PROCESSOR] Error processing label:`, error);
      }
    }
  }

  private async processFeedGenerator(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping feed generator ${uri} - creator not ready`);
      return;
    }

    const feedGenerator: InsertFeedGenerator = {
      uri,
      cid,
      creatorDid,
      did: record.did,
      displayName: sanitizeRequiredText(record.displayName),
      description: sanitizeText(record.description),
      avatarUrl: record.avatar?.ref?.$link,
      createdAt: new Date(record.createdAt),
    };

    await storage.createFeedGenerator(feedGenerator);
  }

  private async processStarterPack(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping starter pack ${uri} - creator not ready`);
      return;
    }

    const starterPack: InsertStarterPack = {
      uri,
      cid,
      creatorDid,
      name: sanitizeRequiredText(record.name),
      description: sanitizeText(record.description),
      listUri: record.list,
      feeds: record.feeds?.map((f: any) => f.uri) || [],
      createdAt: new Date(record.createdAt),
    };

    await storage.createStarterPack(starterPack);
  }

  private async processLabelerService(uri: string, cid: string, creatorDid: string, record: any) {
    const creatorReady = await this.ensureUser(creatorDid);
    if (!creatorReady) {
      console.warn(`[EVENT_PROCESSOR] Skipping labeler service ${uri} - creator not ready`);
      return;
    }

    const labelerService: InsertLabelerService = {
      uri,
      cid,
      creatorDid,
      policies: record.policies || { labelValues: [], labelValueDefinitions: [] },
      createdAt: new Date(record.createdAt),
    };

    await storage.createLabelerService(labelerService);
    console.log(`[LABELER_SERVICE] Processed labeler service ${uri} for ${creatorDid}`);
  }

  private async processDelete(uri: string, collection: string) {
    // Cancel pending op if it's a like/repost being deleted
    if (collection === "app.bsky.feed.like" || collection === "app.bsky.feed.repost") {
      this.cancelPendingOp(uri);
    }
    
    // If it's a post being deleted, clear all pending likes/reposts for it
    if (collection === "app.bsky.feed.post") {
      const ops = this.pendingOps.get(uri);
      if (ops && ops.length > 0) {
        // Remove from index and update count
        for (const op of ops) {
          this.pendingOpIndex.delete(op.payload.uri);
          this.totalPendingCount--;
        }
        this.pendingOps.delete(uri);
        console.log(`[EVENT_PROCESSOR] Cleared ${ops.length} pending operations for deleted post ${uri}`);
      }
    }
    
    switch (collection) {
      case "app.bsky.feed.post":
        await storage.deletePost(uri);
        break;
      case "app.bsky.feed.like":
        await storage.deleteLike(uri);
        break;
      case "app.bsky.feed.repost":
        await storage.deleteRepost(uri);
        break;
      case "app.bsky.graph.follow":
        await storage.deleteFollow(uri);
        break;
      case "app.bsky.graph.block":
        await storage.deleteBlock(uri);
        break;
      case "app.bsky.graph.list":
        await storage.deleteList(uri);
        break;
      case "app.bsky.graph.listitem":
        await storage.deleteListItem(uri);
        break;
      case "app.bsky.feed.generator":
        await storage.deleteFeedGenerator(uri);
        break;
      case "app.bsky.graph.starterpack":
        await storage.deleteStarterPack(uri);
        break;
      case "app.bsky.labeler.service":
        await storage.deleteLabelerService(uri);
        break;
      case "com.atproto.label.label":
        await labelService.removeLabel(uri);
        break;
    }
  }
}

export const eventProcessor = new EventProcessor();
