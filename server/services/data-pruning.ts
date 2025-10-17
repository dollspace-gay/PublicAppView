import { db } from '../db';
import {
  posts,
  likes,
  reposts,
  notifications,
  sessions,
  follows,
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

        const batchTotal =
          deletedPosts.length +
          deletedLikes.length +
          deletedReposts.length +
          deletedNotifications.length;
        totalStats.total += batchTotal;

        console.log(
          `[DATA_PRUNING] Batch ${iteration}: Deleted ${batchTotal} records (posts: ${deletedPosts.length}, likes: ${deletedLikes.length}, reposts: ${deletedReposts.length}, notifications: ${deletedNotifications.length})`
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
        `[DATA_PRUNING] Completed - Deleted ${totalStats.total} total records (${totalStats.posts} posts, ${totalStats.likes} likes, ${totalStats.reposts} reposts, ${totalStats.notifications} notifications). Protected ${protectedDids.size} DIDs from pruning.`
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
