import { db } from "../db";
import { posts, likes, reposts, notifications } from "../../shared/schema";
import { sql } from "drizzle-orm";
import { logCollector } from "./log-collector";

export class DataPruningService {
  private pruneInterval: NodeJS.Timeout | null = null;
  private readonly retentionDays: number;
  private readonly PRUNE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Run once per day

  constructor() {
    // 0 = keep forever, >0 = prune after X days
    const retentionDaysRaw = parseInt(process.env.DATA_RETENTION_DAYS || "0");
    this.retentionDays = !isNaN(retentionDaysRaw) && retentionDaysRaw >= 0 ? retentionDaysRaw : 0;
    
    if (process.env.DATA_RETENTION_DAYS && isNaN(retentionDaysRaw)) {
      console.warn(`[DATA_PRUNING] Invalid DATA_RETENTION_DAYS value "${process.env.DATA_RETENTION_DAYS}" - using default (0)`);
    }
    
    if (this.retentionDays > 0) {
      console.log(`[DATA_PRUNING] Enabled - will prune content older than ${this.retentionDays} days`);
      logCollector.info(`Data pruning enabled - retention: ${this.retentionDays} days`);
      
      // Run immediately on startup, then every 24 hours
      this.pruneOldData();
      this.startScheduledPruning();
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

    console.log(`[DATA_PRUNING] Starting pruning job - deleting data older than ${cutoffDate.toISOString()}`);
    logCollector.info(`Data pruning started - cutoff: ${cutoffDate.toISOString()}`);

    try {
      // Prune posts
      const deletedPosts = await db.delete(posts)
        .where(sql`${posts.createdAt} < ${cutoffDate}`)
        .returning({ uri: posts.uri });
      
      // Prune likes
      const deletedLikes = await db.delete(likes)
        .where(sql`${likes.createdAt} < ${cutoffDate}`)
        .returning({ uri: likes.uri });
      
      // Prune reposts
      const deletedReposts = await db.delete(reposts)
        .where(sql`${reposts.createdAt} < ${cutoffDate}`)
        .returning({ uri: reposts.uri });
      
      // Prune notifications
      const deletedNotifications = await db.delete(notifications)
        .where(sql`${notifications.createdAt} < ${cutoffDate}`)
        .returning({ uri: notifications.uri });

      const stats = {
        posts: deletedPosts.length,
        likes: deletedLikes.length,
        reposts: deletedReposts.length,
        notifications: deletedNotifications.length,
        total: deletedPosts.length + deletedLikes.length + deletedReposts.length + deletedNotifications.length
      };

      console.log(`[DATA_PRUNING] Completed - Deleted ${stats.total} records (${stats.posts} posts, ${stats.likes} likes, ${stats.reposts} reposts, ${stats.notifications} notifications)`);
      logCollector.success(`Data pruning completed - ${stats.total} records deleted`, stats);

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
