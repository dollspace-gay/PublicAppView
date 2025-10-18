import { db } from '../db';
import {
  posts,
  likes,
  reposts,
  notifications,
  sessions,
  follows,
  users,
  blocks,
  mutes,
  feedGenerators,
  starterPacks,
  lists,
  listItems,
  bookmarks,
  quotes,
  feedItems,
  postAggregations,
  threadGates,
  postGates,
} from '../../shared/schema';
import { sql, gt } from 'drizzle-orm';
import { logCollector } from './log-collector';

export class DataPruningService {
  private pruneInterval: NodeJS.Timeout | null = null;
  private readonly retentionDays: number;
  private readonly PRUNE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Run once per day
  private readonly MAX_DELETION_PER_RUN = 10000; // Safety: Limit deletions per run

  constructor() {
    // 0 = keep forever, >0 = prune after X days
    const retentionDaysRaw = parseInt(process.env.DATA_RETENTION_DAYS || '0');
    const requestedDays =
      !isNaN(retentionDaysRaw) && retentionDaysRaw >= 0 ? retentionDaysRaw : 0;

    if (process.env.DATA_RETENTION_DAYS && isNaN(retentionDaysRaw)) {
      console.warn(
        `[DATA_PRUNING] Invalid DATA_RETENTION_DAYS value "${process.env.DATA_RETENTION_DAYS}" - using default (0)`
      );
    }

    this.retentionDays = requestedDays;

    if (this.retentionDays > 0) {
      console.log(
        `[DATA_PRUNING] Enabled - will prune content older than ${this.retentionDays} days (max ${this.MAX_DELETION_PER_RUN} records per run)`
      );
      logCollector.info(
        `Data pruning enabled - retention: ${this.retentionDays} days`
      );

      // SAFETY: Don't run immediately on startup, wait 1 hour
      setTimeout(
        () => {
          this.pruneOldData();
          this.startScheduledPruning();
        },
        60 * 60 * 1000
      );
      console.log(
        '[DATA_PRUNING] First run scheduled in 1 hour (startup safety delay)'
      );
    } else {
      console.log(
        '[DATA_PRUNING] Disabled - keeping all data forever (DATA_RETENTION_DAYS=0)'
      );
    }
  }

  private startScheduledPruning() {
    this.pruneInterval = setInterval(() => {
      this.pruneOldData();
    }, this.PRUNE_CHECK_INTERVAL);
  }

  /**
   * Get list of DIDs that should be protected from pruning
   * Includes ALL users who have ever had a session (past or present) and users they follow
   * This ensures user-backfilled data is never pruned unless they explicitly delete it
   */
  private async getProtectedDids(): Promise<Set<string>> {
    const protectedDids = new Set<string>();

    try {
      // Get ALL users who have EVER had a session (active or expired)
      // These are users who have used the AppView and may have backfilled data
      const allSessions = await db
        .select({ userDid: sessions.userDid })
        .from(sessions);

      const registeredUserDids = [
        ...new Set(allSessions.map((s) => s.userDid)),
      ];

      console.log(
        `[DATA_PRUNING] Found ${registeredUserDids.length} total users who have ever logged in`
      );

      // Add all registered users to protected list
      registeredUserDids.forEach((did) => protectedDids.add(did));

      // For each registered user, get their follows
      // This protects content from people they follow (their timeline content)
      for (const userDid of registeredUserDids) {
        const userFollows = await db
          .select({ followingDid: follows.followingDid })
          .from(follows)
          .where(sql`${follows.followerDid} = ${userDid}`);

        userFollows.forEach((f) => protectedDids.add(f.followingDid));
      }

      console.log(
        `[DATA_PRUNING] Protecting ${protectedDids.size} total DIDs (registered users + their follows)`
      );
    } catch (error) {
      console.error('[DATA_PRUNING] Error getting protected DIDs:', error);
      // On error, return empty set (fail-safe: prune nothing rather than prune everything)
      return new Set<string>();
    }

    return protectedDids;
  }

  private async pruneOldData() {
    if (this.retentionDays === 0) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    console.log(
      `[DATA_PRUNING] Starting pruning job - deleting data older than ${cutoffDate.toISOString()} (batch size: ${this.MAX_DELETION_PER_RUN})`
    );
    logCollector.info(
      `Data pruning started - cutoff: ${cutoffDate.toISOString()}`
    );

    // Get protected DIDs (active users + their follows)
    const protectedDids = await this.getProtectedDids();

    if (protectedDids.size === 0) {
      console.warn(
        '[DATA_PRUNING] No protected DIDs found - skipping pruning for safety'
      );
      return;
    }

    const totalStats = {
      posts: 0,
      likes: 0,
      reposts: 0,
      notifications: 0,
      quotes: 0,
      bookmarks: 0,
      blocks: 0,
      mutes: 0,
      feedItems: 0,
      postAggregations: 0,
      threadGates: 0,
      postGates: 0,
      users: 0,
      follows: 0,
      feedGenerators: 0,
      starterPacks: 0,
      lists: 0,
      listItems: 0,
      total: 0,
    };

    try {
      // Prune in batches until nothing remains (with overall safety limit)
      const MAX_ITERATIONS = 100; // Safety: prevent infinite loops
      let iteration = 0;

      while (iteration < MAX_ITERATIONS) {
        iteration++;
        let batchHadDeletions = false;

        // Prune posts with limit (exclude protected DIDs)
        const deletedPosts = await db
          .delete(posts)
          .where(
            sql`${posts.uri} IN (
            SELECT uri FROM ${posts}
            WHERE ${posts.createdAt} < ${cutoffDate}
            AND ${posts.authorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: posts.uri });

        if (deletedPosts.length > 0) {
          totalStats.posts += deletedPosts.length;
          batchHadDeletions = true;
        }

        // Prune likes with limit (exclude protected DIDs)
        const deletedLikes = await db
          .delete(likes)
          .where(
            sql`${likes.uri} IN (
            SELECT uri FROM ${likes}
            WHERE ${likes.createdAt} < ${cutoffDate}
            AND ${likes.userDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: likes.uri });

        if (deletedLikes.length > 0) {
          totalStats.likes += deletedLikes.length;
          batchHadDeletions = true;
        }

        // Prune reposts with limit (exclude protected DIDs)
        const deletedReposts = await db
          .delete(reposts)
          .where(
            sql`${reposts.uri} IN (
            SELECT uri FROM ${reposts}
            WHERE ${reposts.createdAt} < ${cutoffDate}
            AND ${reposts.userDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: reposts.uri });

        if (deletedReposts.length > 0) {
          totalStats.reposts += deletedReposts.length;
          batchHadDeletions = true;
        }

        // Prune notifications with limit (exclude protected DIDs)
        const deletedNotifications = await db
          .delete(notifications)
          .where(
            sql`${notifications.uri} IN (
            SELECT uri FROM ${notifications}
            WHERE ${notifications.createdAt} < ${cutoffDate}
            AND ${notifications.recipientDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: notifications.uri });

        if (deletedNotifications.length > 0) {
          totalStats.notifications += deletedNotifications.length;
          batchHadDeletions = true;
        }

        // Prune quotes with limit (exclude protected DIDs)
        const deletedQuotes = await db
          .delete(quotes)
          .where(
            sql`${quotes.uri} IN (
            SELECT uri FROM ${quotes}
            WHERE ${quotes.createdAt} < ${cutoffDate}
            AND ${quotes.authorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: quotes.uri });

        if (deletedQuotes.length > 0) {
          totalStats.quotes += deletedQuotes.length;
          batchHadDeletions = true;
        }

        // Prune bookmarks with limit (exclude protected DIDs)
        const deletedBookmarks = await db
          .delete(bookmarks)
          .where(
            sql`${bookmarks.uri} IN (
            SELECT uri FROM ${bookmarks}
            WHERE ${bookmarks.createdAt} < ${cutoffDate}
            AND ${bookmarks.userDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: bookmarks.uri });

        if (deletedBookmarks.length > 0) {
          totalStats.bookmarks += deletedBookmarks.length;
          batchHadDeletions = true;
        }

        // Prune blocks with limit (exclude protected DIDs)
        const deletedBlocks = await db
          .delete(blocks)
          .where(
            sql`${blocks.uri} IN (
            SELECT uri FROM ${blocks}
            WHERE ${blocks.createdAt} < ${cutoffDate}
            AND ${blocks.blockerDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: blocks.uri });

        if (deletedBlocks.length > 0) {
          totalStats.blocks += deletedBlocks.length;
          batchHadDeletions = true;
        }

        // Prune mutes with limit (exclude protected DIDs)
        const deletedMutes = await db
          .delete(mutes)
          .where(
            sql`${mutes.uri} IN (
            SELECT uri FROM ${mutes}
            WHERE ${mutes.createdAt} < ${cutoffDate}
            AND ${mutes.muterDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: mutes.uri });

        if (deletedMutes.length > 0) {
          totalStats.mutes += deletedMutes.length;
          batchHadDeletions = true;
        }

        // Prune feed items with limit (exclude protected DIDs' posts)
        const deletedFeedItems = await db
          .delete(feedItems)
          .where(
            sql`${feedItems.postUri} IN (
            SELECT post_uri FROM ${feedItems}
            WHERE ${feedItems.createdAt} < ${cutoffDate}
            AND ${feedItems.authorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ postUri: feedItems.postUri });

        if (deletedFeedItems.length > 0) {
          totalStats.feedItems += deletedFeedItems.length;
          batchHadDeletions = true;
        }

        // Prune post aggregations with limit (exclude protected DIDs' posts)
        const deletedPostAggregations = await db
          .delete(postAggregations)
          .where(
            sql`${postAggregations.uri} IN (
            SELECT uri FROM ${postAggregations}
            JOIN ${posts} ON ${postAggregations.uri} = ${posts.uri}
            WHERE ${posts.createdAt} < ${cutoffDate}
            AND ${posts.authorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: postAggregations.uri });

        if (deletedPostAggregations.length > 0) {
          totalStats.postAggregations += deletedPostAggregations.length;
          batchHadDeletions = true;
        }

        // Prune thread gates with limit (exclude protected DIDs' posts)
        const deletedThreadGates = await db
          .delete(threadGates)
          .where(
            sql`${threadGates.postUri} IN (
            SELECT post_uri FROM ${threadGates}
            JOIN ${posts} ON ${threadGates.postUri} = ${posts.uri}
            WHERE ${posts.createdAt} < ${cutoffDate}
            AND ${posts.authorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ postUri: threadGates.postUri });

        if (deletedThreadGates.length > 0) {
          totalStats.threadGates += deletedThreadGates.length;
          batchHadDeletions = true;
        }

        // Prune post gates with limit (exclude protected DIDs' posts)
        const deletedPostGates = await db
          .delete(postGates)
          .where(
            sql`${postGates.postUri} IN (
            SELECT post_uri FROM ${postGates}
            JOIN ${posts} ON ${postGates.postUri} = ${posts.uri}
            WHERE ${posts.createdAt} < ${cutoffDate}
            AND ${posts.authorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ postUri: postGates.postUri });

        if (deletedPostGates.length > 0) {
          totalStats.postGates += deletedPostGates.length;
          batchHadDeletions = true;
        }

        // Prune users with limit (exclude protected DIDs)
        const deletedUsers = await db
          .delete(users)
          .where(
            sql`${users.did} IN (
            SELECT did FROM ${users}
            WHERE ${users.indexedAt} < ${cutoffDate}
            AND ${users.did} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ did: users.did });

        if (deletedUsers.length > 0) {
          totalStats.users += deletedUsers.length;
          batchHadDeletions = true;
        }

        // Prune follows with limit (exclude protected DIDs as follower or following)
        const deletedFollows = await db
          .delete(follows)
          .where(
            sql`${follows.uri} IN (
            SELECT uri FROM ${follows}
            WHERE ${follows.createdAt} < ${cutoffDate}
            AND ${follows.followerDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            AND ${follows.followingDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: follows.uri });

        if (deletedFollows.length > 0) {
          totalStats.follows += deletedFollows.length;
          batchHadDeletions = true;
        }

        // Prune feed generators with limit (exclude protected creators)
        const deletedFeedGenerators = await db
          .delete(feedGenerators)
          .where(
            sql`${feedGenerators.uri} IN (
            SELECT uri FROM ${feedGenerators}
            WHERE ${feedGenerators.indexedAt} < ${cutoffDate}
            AND ${feedGenerators.creatorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: feedGenerators.uri });

        if (deletedFeedGenerators.length > 0) {
          totalStats.feedGenerators += deletedFeedGenerators.length;
          batchHadDeletions = true;
        }

        // Prune starter packs with limit (exclude protected creators)
        const deletedStarterPacks = await db
          .delete(starterPacks)
          .where(
            sql`${starterPacks.uri} IN (
            SELECT uri FROM ${starterPacks}
            WHERE ${starterPacks.createdAt} < ${cutoffDate}
            AND ${starterPacks.creatorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: starterPacks.uri });

        if (deletedStarterPacks.length > 0) {
          totalStats.starterPacks += deletedStarterPacks.length;
          batchHadDeletions = true;
        }

        // Prune lists with limit (exclude protected creators)
        const deletedLists = await db
          .delete(lists)
          .where(
            sql`${lists.uri} IN (
            SELECT uri FROM ${lists}
            WHERE ${lists.createdAt} < ${cutoffDate}
            AND ${lists.creatorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: lists.uri });

        if (deletedLists.length > 0) {
          totalStats.lists += deletedLists.length;
          batchHadDeletions = true;
        }

        // Prune list items with limit (exclude protected users' lists)
        const deletedListItems = await db
          .delete(listItems)
          .where(
            sql`${listItems.uri} IN (
            SELECT uri FROM ${listItems}
            JOIN ${lists} ON ${listItems.listUri} = ${lists.uri}
            WHERE ${listItems.createdAt} < ${cutoffDate}
            AND ${lists.creatorDid} NOT IN (${sql.join(
              Array.from(protectedDids).map((did) => sql`${did}`),
              sql`, `
            )})
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`
          )
          .returning({ uri: listItems.uri });

        if (deletedListItems.length > 0) {
          totalStats.listItems += deletedListItems.length;
          batchHadDeletions = true;
        }

        const batchTotal =
          deletedPosts.length +
          deletedLikes.length +
          deletedReposts.length +
          deletedNotifications.length +
          deletedQuotes.length +
          deletedBookmarks.length +
          deletedBlocks.length +
          deletedMutes.length +
          deletedFeedItems.length +
          deletedPostAggregations.length +
          deletedThreadGates.length +
          deletedPostGates.length +
          deletedUsers.length +
          deletedFollows.length +
          deletedFeedGenerators.length +
          deletedStarterPacks.length +
          deletedLists.length +
          deletedListItems.length;
        totalStats.total += batchTotal;

        console.log(
          `[DATA_PRUNING] Batch ${iteration}: Deleted ${batchTotal} records (posts: ${deletedPosts.length}, likes: ${deletedLikes.length}, reposts: ${deletedReposts.length}, notifications: ${deletedNotifications.length}, quotes: ${deletedQuotes.length}, bookmarks: ${deletedBookmarks.length}, blocks: ${deletedBlocks.length}, mutes: ${deletedMutes.length}, feedItems: ${deletedFeedItems.length}, postAgg: ${deletedPostAggregations.length}, threadGates: ${deletedThreadGates.length}, postGates: ${deletedPostGates.length}, users: ${deletedUsers.length}, follows: ${deletedFollows.length}, feedGens: ${deletedFeedGenerators.length}, starterPacks: ${deletedStarterPacks.length}, lists: ${deletedLists.length}, listItems: ${deletedListItems.length})`
        );

        // Stop if NO table had deletions (all tables exhausted)
        if (!batchHadDeletions) {
          break;
        }
      }

      if (iteration >= MAX_ITERATIONS) {
        console.warn(
          `[DATA_PRUNING] Reached max iterations (${MAX_ITERATIONS}), more old data may remain`
        );
      }

      console.log(
        `[DATA_PRUNING] Completed - Deleted ${totalStats.total} total records:\n` +
        `  Posts: ${totalStats.posts}, Likes: ${totalStats.likes}, Reposts: ${totalStats.reposts}, Notifications: ${totalStats.notifications}\n` +
        `  Quotes: ${totalStats.quotes}, Bookmarks: ${totalStats.bookmarks}, Blocks: ${totalStats.blocks}, Mutes: ${totalStats.mutes}\n` +
        `  Feed Items: ${totalStats.feedItems}, Post Aggs: ${totalStats.postAggregations}, Thread Gates: ${totalStats.threadGates}, Post Gates: ${totalStats.postGates}\n` +
        `  Users: ${totalStats.users}, Follows: ${totalStats.follows}, Feed Generators: ${totalStats.feedGenerators}\n` +
        `  Starter Packs: ${totalStats.starterPacks}, Lists: ${totalStats.lists}, List Items: ${totalStats.listItems}\n` +
        `  Protected ${protectedDids.size} DIDs from pruning.`
      );
      logCollector.success(
        `Data pruning completed - ${totalStats.total} records deleted, ${protectedDids.size} DIDs protected`,
        { ...totalStats, protectedDids: protectedDids.size }
      );

      // Redis counters will auto-refresh from database on next stats query
      // No need to manually decrement - the background refresh handles it
    } catch (error) {
      console.error('[DATA_PRUNING] Error during pruning:', error);
      logCollector.error('Data pruning failed', { error });
    }
  }

  stop() {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
      console.log('[DATA_PRUNING] Stopped');
    }
  }
}

export const dataPruningService = new DataPruningService();
