import { db } from "../db";
import { posts, likes, reposts, notifications } from "../../shared/schema";
import { sql } from "drizzle-orm";
import { logCollector } from "./log-collector";

export class DataPruningService {
  private pruneInterval: NodeJS.Timeout | null = null;
  private readonly retentionDays: number;
  private readonly PRUNE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Run once per day
  private readonly MIN_RETENTION_DAYS = 7; // Safety: Don't allow pruning data newer than 7 days
  private readonly MAX_DELETION_PER_RUN = 10000; // Safety: Limit deletions per run

  constructor() {
    // 0 = keep forever, >0 = prune after X days
    const retentionDaysRaw = parseInt(process.env.DATA_RETENTION_DAYS || "0");
    let requestedDays = !isNaN(retentionDaysRaw) && retentionDaysRaw >= 0 ? retentionDaysRaw : 0;
    
    if (process.env.DATA_RETENTION_DAYS && isNaN(retentionDaysRaw)) {
      console.warn(`[DATA_PRUNING] Invalid DATA_RETENTION_DAYS value "${process.env.DATA_RETENTION_DAYS}" - using default (0)`);
    }
    
    // Safety check: Enforce minimum retention period
    if (requestedDays > 0 && requestedDays < this.MIN_RETENTION_DAYS) {
      console.warn(`[DATA_PRUNING] Safety limit enforced: ${requestedDays} days increased to minimum ${this.MIN_RETENTION_DAYS} days`);
      logCollector.info(`Data retention too low, enforcing minimum ${this.MIN_RETENTION_DAYS} days`);
      requestedDays = this.MIN_RETENTION_DAYS;
    }
    
    this.retentionDays = requestedDays;
    
    if (this.retentionDays > 0) {
      console.log(`[DATA_PRUNING] Enabled - will prune content older than ${this.retentionDays} days (max ${this.MAX_DELETION_PER_RUN} records per run)`);
      logCollector.info(`Data pruning enabled - retention: ${this.retentionDays} days`);
      
      // SAFETY: Don't run immediately on startup, wait 1 hour
      setTimeout(() => {
        this.pruneOldData();
        this.startScheduledPruning();
      }, 60 * 60 * 1000);
      console.log("[DATA_PRUNING] First run scheduled in 1 hour (startup safety delay)");
    } else {
      console.log("[DATA_PRUNING] Disabled - keeping all data forever (DATA_RETENTION_DAYS=0)");
    }
  }

  private startScheduledPruning() {
    this.pruneInterval = setInterval(() => {
      this.pruneOldData();
    }, this.PRUNE_CHECK_INTERVAL);
  }

  private async pruneOldData() {
    if (this.retentionDays === 0) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    console.log(`[DATA_PRUNING] Starting pruning job - deleting data older than ${cutoffDate.toISOString()} (batch size: ${this.MAX_DELETION_PER_RUN})`);
    logCollector.info(`Data pruning started - cutoff: ${cutoffDate.toISOString()}`);

    let totalStats = {
      posts: 0,
      likes: 0,
      reposts: 0,
      notifications: 0,
      total: 0
    };

    try {
      // Prune in batches until nothing remains (with overall safety limit)
      const MAX_ITERATIONS = 100; // Safety: prevent infinite loops
      let iteration = 0;
      
      while (iteration < MAX_ITERATIONS) {
        iteration++;
        let batchHadDeletions = false;
        
        // Prune posts with limit
        const deletedPosts = await db.delete(posts)
          .where(sql`${posts.uri} IN (
            SELECT uri FROM ${posts} 
            WHERE ${posts.createdAt} < ${cutoffDate} 
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`)
          .returning({ uri: posts.uri });
        
        if (deletedPosts.length > 0) {
          totalStats.posts += deletedPosts.length;
          batchHadDeletions = true;
        }
        
        // Prune likes with limit
        const deletedLikes = await db.delete(likes)
          .where(sql`${likes.uri} IN (
            SELECT uri FROM ${likes}
            WHERE ${likes.createdAt} < ${cutoffDate}
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`)
          .returning({ uri: likes.uri });
        
        if (deletedLikes.length > 0) {
          totalStats.likes += deletedLikes.length;
          batchHadDeletions = true;
        }
        
        // Prune reposts with limit
        const deletedReposts = await db.delete(reposts)
          .where(sql`${reposts.uri} IN (
            SELECT uri FROM ${reposts}
            WHERE ${reposts.createdAt} < ${cutoffDate}
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`)
          .returning({ uri: reposts.uri });
        
        if (deletedReposts.length > 0) {
          totalStats.reposts += deletedReposts.length;
          batchHadDeletions = true;
        }
        
        // Prune notifications with limit
        const deletedNotifications = await db.delete(notifications)
          .where(sql`${notifications.uri} IN (
            SELECT uri FROM ${notifications}
            WHERE ${notifications.createdAt} < ${cutoffDate}
            LIMIT ${this.MAX_DELETION_PER_RUN}
          )`)
          .returning({ uri: notifications.uri });

        if (deletedNotifications.length > 0) {
          totalStats.notifications += deletedNotifications.length;
          batchHadDeletions = true;
        }

        const batchTotal = deletedPosts.length + deletedLikes.length + deletedReposts.length + deletedNotifications.length;
        totalStats.total += batchTotal;

        console.log(`[DATA_PRUNING] Batch ${iteration}: Deleted ${batchTotal} records (posts: ${deletedPosts.length}, likes: ${deletedLikes.length}, reposts: ${deletedReposts.length}, notifications: ${deletedNotifications.length})`);

        // Stop if NO table had deletions (all tables exhausted)
        if (!batchHadDeletions) {
          break;
        }
      }

      if (iteration >= MAX_ITERATIONS) {
        console.warn(`[DATA_PRUNING] Reached max iterations (${MAX_ITERATIONS}), more old data may remain`);
      }

      console.log(`[DATA_PRUNING] Completed - Deleted ${totalStats.total} total records (${totalStats.posts} posts, ${totalStats.likes} likes, ${totalStats.reposts} reposts, ${totalStats.notifications} notifications)`);
      logCollector.success(`Data pruning completed - ${totalStats.total} records deleted`, totalStats);

      // Redis counters will auto-refresh from database on next stats query
      // No need to manually decrement - the background refresh handles it

    } catch (error) {
      console.error("[DATA_PRUNING] Error during pruning:", error);
      logCollector.error("Data pruning failed", { error });
    }
  }

  stop() {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
      console.log("[DATA_PRUNING] Stopped");
    }
  }
}

export const dataPruningService = new DataPruningService();
