/**
 * Automatic Backfill Service for Liked Posts
 * Checks for missing liked posts and backfills them automatically in the background
 */

import { AtpAgent } from '@atproto/api';
import { storage } from '../storage';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { likes, posts, userSettings } from '@shared/schema';
import { EventProcessor } from './event-processor';

const BATCH_SIZE = 100;
const CONCURRENT_FETCHES = 10;
const PDS_HOST = process.env.PDS_HOST || 'https://bsky.network';
const MIN_MISSING_THRESHOLD = 10; // Only backfill if at least 10 posts are missing
const BACKFILL_COOLDOWN_HOURS = 24; // Don't re-backfill more than once per day

// Track ongoing backfills to prevent duplicates
const ongoingBackfills = new Set<string>();

export class AutoBackfillLikesService {
  /**
   * Check if a user needs liked posts backfilled and trigger it if needed
   * Called automatically on login or periodically
   */
  async checkAndBackfill(userDid: string): Promise<boolean> {
    // Skip if already backfilling for this user
    if (ongoingBackfills.has(userDid)) {
      console.log(`[AUTO_BACKFILL_LIKES] Already backfilling for ${userDid}`);
      return false;
    }

    try {
      // Check cooldown - don't backfill if we did it recently
      const settings = await db.query.userSettings.findFirst({
        where: (s, { eq }) => eq(s.userDid, userDid),
      });

      if (settings?.lastLikedPostsBackfill) {
        const hoursSinceLastBackfill =
          (Date.now() - settings.lastLikedPostsBackfill.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastBackfill < BACKFILL_COOLDOWN_HOURS) {
          console.log(
            `[AUTO_BACKFILL_LIKES] Skipping ${userDid} - backfilled ${Math.round(hoursSinceLastBackfill)}h ago`
          );
          return false;
        }
      }

      // Count missing liked posts
      const result = await db.execute(
        sql`
          SELECT COUNT(DISTINCT l.post_uri) as missing_count
          FROM ${likes} l
          LEFT JOIN ${posts} p ON l.post_uri = p.uri
          WHERE l.user_did = ${userDid} AND p.uri IS NULL
        `
      );

      const missingCount = parseInt((result.rows[0] as any).missing_count || '0');

      if (missingCount < MIN_MISSING_THRESHOLD) {
        console.log(
          `[AUTO_BACKFILL_LIKES] User ${userDid} has ${missingCount} missing posts - below threshold`
        );
        return false;
      }

      console.log(
        `[AUTO_BACKFILL_LIKES] User ${userDid} has ${missingCount} missing liked posts - triggering backfill`
      );

      // Trigger backfill in background
      this.backfillInBackground(userDid, missingCount);

      return true;
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_LIKES] Error checking user ${userDid}:`,
        error
      );
      return false;
    }
  }

  /**
   * Run backfill in the background (non-blocking)
   */
  private backfillInBackground(userDid: string, estimatedCount: number): void {
    ongoingBackfills.add(userDid);

    (async () => {
      try {
        console.log(
          `[AUTO_BACKFILL_LIKES] Starting background backfill for ${userDid} (~${estimatedCount} posts)`
        );

        // Get missing post URIs
        const missingPosts = await db.execute(
          sql`
            SELECT DISTINCT l.post_uri
            FROM ${likes} l
            LEFT JOIN ${posts} p ON l.post_uri = p.uri
            WHERE l.user_did = ${userDid} AND p.uri IS NULL
            LIMIT 10000
          `
        );

        const missingPostUris = missingPosts.rows.map((row: any) => row.post_uri);

        if (missingPostUris.length === 0) {
          console.log(`[AUTO_BACKFILL_LIKES] No posts to fetch for ${userDid}`);
          return;
        }

        const agent = new AtpAgent({ service: PDS_HOST });
        const eventProcessor = new EventProcessor(storage);
        eventProcessor.setSkipPdsFetching(true);
        eventProcessor.setSkipDataCollectionCheck(true);

        let fetchedCount = 0;
        let failedCount = 0;
        let skippedCount = 0;

        // Process in batches
        for (let i = 0; i < missingPostUris.length; i += BATCH_SIZE) {
          const batch = missingPostUris.slice(i, i + BATCH_SIZE);

          // Fetch in parallel chunks
          const chunks = [];
          for (let j = 0; j < batch.length; j += CONCURRENT_FETCHES) {
            chunks.push(batch.slice(j, j + CONCURRENT_FETCHES));
          }

          for (const chunk of chunks) {
            try {
              // Use getPosts (plural) to fetch multiple posts from the AppView
              const response = await agent.app.bsky.feed.getPosts({ uris: chunk });

              if (response.data.posts && response.data.posts.length > 0) {
                // Process each fetched post
                for (const post of response.data.posts) {
                  try {
                    const parts = post.uri.split('/');
                    const repo = parts[2];
                    const rkey = parts[parts.length - 1];

                    await eventProcessor.processCommit(
                      {
                        repo,
                        ops: [
                          {
                            action: 'create',
                            path: `app.bsky.feed.post/${rkey}`,
                            cid: post.cid,
                            record: post.record,
                          },
                        ],
                        time: new Date().toISOString(),
                        rev: '',
                      } as any
                    );

                    fetchedCount++;
                  } catch (error: any) {
                    console.error(`[AUTO_BACKFILL_LIKES] Error processing post ${post.uri}:`, error.message);
                    failedCount++;
                  }
                }

                // Count posts that weren't returned (deleted)
                skippedCount += chunk.length - response.data.posts.length;
              } else {
                // All posts in chunk are missing
                skippedCount += chunk.length;
              }

              if (fetchedCount % 500 === 0) {
                console.log(
                  `[AUTO_BACKFILL_LIKES] Progress for ${userDid}: ${fetchedCount}/${missingPostUris.length} (${failedCount} failed, ${skippedCount} skipped)`
                );
              }
            } catch (error: any) {
              console.error(`[AUTO_BACKFILL_LIKES] Error fetching chunk:`, error.message);
              failedCount += chunk.length;
            }
          }
        }

        // Update last backfill timestamp
        await db
          .insert(userSettings)
          .values({
            userDid,
            lastLikedPostsBackfill: new Date(),
          })
          .onConflictDoUpdate({
            target: userSettings.userDid,
            set: {
              lastLikedPostsBackfill: new Date(),
            },
          });

        console.log(
          `[AUTO_BACKFILL_LIKES] Complete for ${userDid}! ${fetchedCount} fetched, ${failedCount} failed, ${skippedCount} not found`
        );
      } catch (error) {
        console.error(
          `[AUTO_BACKFILL_LIKES] Fatal error for ${userDid}:`,
          error
        );
      } finally {
        ongoingBackfills.delete(userDid);
      }
    })();
  }
}

// Singleton instance
export const autoBackfillLikesService = new AutoBackfillLikesService();
