/**
 * Automatic Backfill Service for Notifications
 * Backfills notifications by fetching interactions on user's posts from Bluesky AppView
 */

import { AtpAgent } from '@atproto/api';
import { storage } from '../storage';
import { db } from '../db';
import { userSettings, posts } from '@shared/schema';
import { eq } from 'drizzle-orm';

const BACKFILL_COOLDOWN_HOURS = 1;
const CONCURRENT_FETCHES = 5;

// Track ongoing backfills to prevent duplicates
const ongoingBackfills = new Set<string>();

export class AutoBackfillNotificationsService {
  /**
   * Check if a user needs notifications backfilled and trigger it if needed
   */
  async checkAndBackfill(userDid: string): Promise<boolean> {
    if (ongoingBackfills.has(userDid)) {
      console.log(
        `[AUTO_BACKFILL_NOTIFICATIONS] Already backfilling for ${userDid}`
      );
      return false;
    }

    try {
      // Check cooldown
      const settings = await db.query.userSettings.findFirst({
        where: (s, { eq }) => eq(s.userDid, userDid),
      });

      if (settings?.lastNotificationsBackfill) {
        const hoursSinceLastBackfill =
          (Date.now() - settings.lastNotificationsBackfill.getTime()) /
          (1000 * 60 * 60);

        if (hoursSinceLastBackfill < BACKFILL_COOLDOWN_HOURS) {
          console.log(
            `[AUTO_BACKFILL_NOTIFICATIONS] Skipping ${userDid} - backfilled ${Math.round(hoursSinceLastBackfill)}h ago`
          );
          return false;
        }
      }

      console.log(
        `[AUTO_BACKFILL_NOTIFICATIONS] Triggering backfill for ${userDid}`
      );
      this.backfillInBackground(userDid);
      return true;
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_NOTIFICATIONS] Error checking user ${userDid}:`,
        error
      );
      return false;
    }
  }

  /**
   * Manually trigger backfill bypassing cooldown checks
   */
  async forceBackfill(userDid: string): Promise<boolean> {
    if (ongoingBackfills.has(userDid)) {
      console.log(
        `[AUTO_BACKFILL_NOTIFICATIONS] Already backfilling for ${userDid} - skipping force trigger`
      );
      return false;
    }

    console.log(
      `[AUTO_BACKFILL_NOTIFICATIONS] Force backfill triggered for ${userDid} (bypassing cooldown)`
    );

    this.backfillInBackground(userDid);
    return true;
  }

  /**
   * Run backfill in the background (non-blocking)
   */
  private backfillInBackground(userDid: string): void {
    ongoingBackfills.add(userDid);

    (async () => {
      try {
        console.log(
          `[AUTO_BACKFILL_NOTIFICATIONS] Starting background backfill for ${userDid}`
        );

        await this.backfillNotifications(userDid);

        // Update last backfill timestamp
        await db
          .insert(userSettings)
          .values({
            userDid,
            lastNotificationsBackfill: new Date(),
          })
          .onConflictDoUpdate({
            target: userSettings.userDid,
            set: {
              lastNotificationsBackfill: new Date(),
            },
          });

        console.log(`[AUTO_BACKFILL_NOTIFICATIONS] Complete for ${userDid}!`);
      } catch (error) {
        console.error(
          `[AUTO_BACKFILL_NOTIFICATIONS] Fatal error for ${userDid}:`,
          error
        );
      } finally {
        ongoingBackfills.delete(userDid);
      }
    })();
  }

  /**
   * Backfill notifications by fetching interactions on user's posts
   * Uses Bluesky public AppView to discover likes/reposts on user's posts
   */
  private async backfillNotifications(userDid: string): Promise<void> {
    try {
      const bskyAppView = 'https://public.api.bsky.app';
      console.log(
        `[AUTO_BACKFILL_NOTIFICATIONS] Using Bluesky AppView: ${bskyAppView}`
      );

      const bskyAgent = new AtpAgent({ service: bskyAppView });

      // Get user's recent posts from our database
      const userPosts = await db
        .select({ uri: posts.uri })
        .from(posts)
        .where(eq(posts.authorDid, userDid))
        .orderBy(posts.createdAt)
        .limit(100); // Check last 100 posts for interactions

      console.log(
        `[AUTO_BACKFILL_NOTIFICATIONS] Checking interactions on ${userPosts.length} posts`
      );

      let notificationsFetched = 0;
      const { EventProcessor } = await import('./event-processor');
      const { didResolver } = await import('./did-resolver');
      const eventProcessor = new EventProcessor(storage);
      eventProcessor.setSkipPdsFetching(true);
      eventProcessor.setSkipDataCollectionCheck(true);

      // Process posts in batches
      for (let i = 0; i < userPosts.length; i += CONCURRENT_FETCHES) {
        const batch = userPosts.slice(i, i + CONCURRENT_FETCHES);

        await Promise.all(
          batch.map(async (post) => {
            try {
              // Fetch likes on this post from Bluesky
              const likesResponse = await bskyAgent.app.bsky.feed.getLikes({
                uri: post.uri,
                limit: 50,
              });

              // Process each like
              for (const like of likesResponse.data.likes) {
                try {
                  // Resolve liker's DID to find their PDS
                  const likerDidDoc = await didResolver.resolveDID(
                    like.actor.did
                  );
                  if (!likerDidDoc) continue;

                  const services = (likerDidDoc as any).service || [];
                  const pdsService = services.find(
                    (s: any) =>
                      s.type === 'AtprotoPersonalDataServer' ||
                      s.id === '#atproto_pds'
                  );

                  if (!pdsService?.serviceEndpoint) continue;

                  // Fetch the actual like record from liker's PDS
                  const likerAgent = new AtpAgent({
                    service: pdsService.serviceEndpoint,
                  });

                  const likeRecords =
                    await likerAgent.com.atproto.repo.listRecords({
                      repo: like.actor.did,
                      collection: 'app.bsky.feed.like',
                      limit: 100,
                    });

                  // Find the like record for this specific post
                  const likeRecord = likeRecords.data.records.find(
                    (r: any) => r.value?.subject?.uri === post.uri
                  );

                  if (likeRecord) {
                    await eventProcessor.processCommit({
                      repo: like.actor.did,
                      ops: [
                        {
                          action: 'create',
                          path: `app.bsky.feed.like/${likeRecord.uri.split('/').pop()}`,
                          cid: likeRecord.cid,
                          record: likeRecord.value,
                        },
                      ],
                      time: new Date().toISOString(),
                      rev: '',
                    } as any);

                    notificationsFetched++;
                  }
                } catch (error: any) {
                  // Skip errors silently for individual likes
                }
              }

              // Fetch reposts on this post
              const repostsResponse =
                await bskyAgent.app.bsky.feed.getRepostedBy({
                  uri: post.uri,
                  limit: 50,
                });

              // Process each repost
              for (const reposter of repostsResponse.data.repostedBy) {
                try {
                  // Resolve reposter's DID
                  const reposterDidDoc = await didResolver.resolveDID(
                    reposter.did
                  );
                  if (!reposterDidDoc) continue;

                  const services = (reposterDidDoc as any).service || [];
                  const pdsService = services.find(
                    (s: any) =>
                      s.type === 'AtprotoPersonalDataServer' ||
                      s.id === '#atproto_pds'
                  );

                  if (!pdsService?.serviceEndpoint) continue;

                  const reposterAgent = new AtpAgent({
                    service: pdsService.serviceEndpoint,
                  });

                  const repostRecords =
                    await reposterAgent.com.atproto.repo.listRecords({
                      repo: reposter.did,
                      collection: 'app.bsky.feed.repost',
                      limit: 100,
                    });

                  const repostRecord = repostRecords.data.records.find(
                    (r: any) => r.value?.subject?.uri === post.uri
                  );

                  if (repostRecord) {
                    await eventProcessor.processCommit({
                      repo: reposter.did,
                      ops: [
                        {
                          action: 'create',
                          path: `app.bsky.feed.repost/${repostRecord.uri.split('/').pop()}`,
                          cid: repostRecord.cid,
                          record: repostRecord.value,
                        },
                      ],
                      time: new Date().toISOString(),
                      rev: '',
                    } as any);

                    notificationsFetched++;
                  }
                } catch (error: any) {
                  // Skip errors silently
                }
              }
            } catch (error: any) {
              console.error(
                `[AUTO_BACKFILL_NOTIFICATIONS] Error processing post ${post.uri}:`,
                error.message
              );
            }
          })
        );

        if ((i + CONCURRENT_FETCHES) % 20 === 0) {
          console.log(
            `[AUTO_BACKFILL_NOTIFICATIONS] Progress: ${i + CONCURRENT_FETCHES}/${userPosts.length} posts checked, ${notificationsFetched} interactions found`
          );
        }
      }

      console.log(
        `[AUTO_BACKFILL_NOTIFICATIONS] Fetched ${notificationsFetched} notification-generating interactions`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_NOTIFICATIONS] Error backfilling notifications:`,
        error
      );
    }
  }
}

// Singleton instance
export const autoBackfillNotificationsService =
  new AutoBackfillNotificationsService();
