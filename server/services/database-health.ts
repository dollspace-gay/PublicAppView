import { db } from '../db';
import { sql } from 'drizzle-orm';
import { users, posts, likes, reposts, follows } from '../../shared/schema';
import { logCollector } from './log-collector';

interface HealthMetrics {
  connected: boolean;
  tablesExist: boolean;
  recordCounts: {
    users: number;
    posts: number;
    likes: number;
    reposts: number;
    follows: number;
  };
  lastCheck: Date;
  errors: string[];
}

export class DatabaseHealthService {
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastKnownCounts: HealthMetrics['recordCounts'] | null = null;
  private readonly CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
  private readonly DATA_LOSS_THRESHOLD = 0.5; // Alert if >50% of data disappears

  constructor() {
    console.log('[DB_HEALTH] Database health monitoring initialized');
  }

  async start() {
    // Run initial health check
    await this.performHealthCheck();

    // Schedule periodic checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.CHECK_INTERVAL);
  }

  async performHealthCheck(): Promise<HealthMetrics> {
    const metrics: HealthMetrics = {
      connected: false,
      tablesExist: false,
      recordCounts: {
        users: 0,
        posts: 0,
        likes: 0,
        reposts: 0,
        follows: 0,
      },
      lastCheck: new Date(),
      errors: [],
    };

    try {
      // Test database connectivity
      await db.execute(sql`SELECT 1`);
      metrics.connected = true;

      // Check if critical tables exist
      const tableCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'users'
        ) as users_exists,
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'posts'
        ) as posts_exists
      `);

      metrics.tablesExist =
        (tableCheck.rows[0] as any)?.users_exists &&
        (tableCheck.rows[0] as any)?.posts_exists;

      if (metrics.tablesExist) {
        // Get record counts
        const [userCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(users);
        const [postCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(posts);
        const [likeCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(likes);
        const [repostCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(reposts);
        const [followCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(follows);

        metrics.recordCounts = {
          users: userCount.count,
          posts: postCount.count,
          likes: likeCount.count,
          reposts: repostCount.count,
          follows: followCount.count,
        };

        // Detect data loss
        if (this.lastKnownCounts) {
          this.detectDataLoss(this.lastKnownCounts, metrics.recordCounts);
        }

        // Update last known counts
        this.lastKnownCounts = metrics.recordCounts;
      } else {
        metrics.errors.push('Critical tables missing');
        console.error('[DB_HEALTH] CRITICAL: Database tables are missing!');
        logCollector.error('Database tables missing', {
          tables: tableCheck.rows,
        });
      }
    } catch (error: any) {
      metrics.connected = false;
      metrics.errors.push(error.message);
      console.error('[DB_HEALTH] Health check failed:', error);
      logCollector.error('Database health check failed', {
        error: error.message,
      });
    }

    // Log status
    if (metrics.connected && metrics.tablesExist) {
      console.log(
        `[DB_HEALTH] ✓ Healthy - Users: ${metrics.recordCounts.users}, Posts: ${metrics.recordCounts.posts}, Likes: ${metrics.recordCounts.likes}`
      );
    } else {
      console.error(
        `[DB_HEALTH] ✗ Unhealthy - Connected: ${metrics.connected}, Tables: ${metrics.tablesExist}`
      );
    }

    return metrics;
  }

  private detectDataLoss(
    previous: HealthMetrics['recordCounts'],
    current: HealthMetrics['recordCounts']
  ) {
    const checks = [
      { name: 'users', prev: previous.users, curr: current.users },
      { name: 'posts', prev: previous.posts, curr: current.posts },
      { name: 'likes', prev: previous.likes, curr: current.likes },
      { name: 'reposts', prev: previous.reposts, curr: current.reposts },
      { name: 'follows', prev: previous.follows, curr: current.follows },
    ];

    for (const check of checks) {
      if (check.prev > 0) {
        const loss = (check.prev - check.curr) / check.prev;

        if (loss > this.DATA_LOSS_THRESHOLD) {
          const message = `CRITICAL DATA LOSS DETECTED: ${check.name} dropped from ${check.prev} to ${check.curr} (${(loss * 100).toFixed(1)}% loss)`;
          console.error(`[DB_HEALTH] ${message}`);
          logCollector.error('Data loss detected', {
            table: check.name,
            previous: check.prev,
            current: check.curr,
            lossPercentage: (loss * 100).toFixed(1),
          });
        }
      }
    }
  }

  async checkConnectionPool(): Promise<{ healthy: boolean; details: any }> {
    try {
      // Test query response time
      const start = Date.now();
      await db.execute(sql`SELECT 1`);
      const responseTime = Date.now() - start;

      const healthy = responseTime < 1000; // Healthy if < 1 second

      return {
        healthy,
        details: {
          responseTimeMs: responseTime,
          status: healthy ? 'healthy' : 'slow',
        },
      };
    } catch (error: any) {
      return {
        healthy: false,
        details: {
          error: error.message,
          status: 'failed',
        },
      };
    }
  }

  stop() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[DB_HEALTH] Stopped');
    }
  }
}

export const databaseHealthService = new DatabaseHealthService();
