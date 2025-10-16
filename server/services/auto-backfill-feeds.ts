/**
 * Automatic Backfill Service for Feed Subscriptions
 * Backfills user's subscribed feed generators from their PDS
 */

import { AtpAgent } from '@atproto/api';
import { storage } from '../storage';
import { db } from '../db';
import { userSettings } from '@shared/schema';
import { EventProcessor } from './event-processor';

const BACKFILL_COOLDOWN_HOURS = 1;

// Track ongoing backfills to prevent duplicates
const ongoingBackfills = new Set<string>();

export class AutoBackfillFeedsService {
  /**
   * Check if a user needs feed subscriptions backfilled and trigger it if needed
   */
  async checkAndBackfill(userDid: string): Promise<boolean> {
    if (ongoingBackfills.has(userDid)) {
      console.log(`[AUTO_BACKFILL_FEEDS] Already backfilling for ${userDid}`);
      return false;
    }

    try {
      // Check cooldown
      const settings = await db.query.userSettings.findFirst({
        where: (s, { eq }) => eq(s.userDid, userDid),
      });

      if (settings?.lastFeedsBackfill) {
        const hoursSinceLastBackfill =
          (Date.now() - settings.lastFeedsBackfill.getTime()) /
          (1000 * 60 * 60);

        if (hoursSinceLastBackfill < BACKFILL_COOLDOWN_HOURS) {
          console.log(
            `[AUTO_BACKFILL_FEEDS] Skipping ${userDid} - backfilled ${Math.round(hoursSinceLastBackfill)}h ago`
          );
          return false;
        }
      }

      console.log(`[AUTO_BACKFILL_FEEDS] Triggering backfill for ${userDid}`);
      this.backfillInBackground(userDid);
      return true;
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FEEDS] Error checking user ${userDid}:`,
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
        `[AUTO_BACKFILL_FEEDS] Already backfilling for ${userDid} - skipping force trigger`
      );
      return false;
    }

    console.log(
      `[AUTO_BACKFILL_FEEDS] Force backfill triggered for ${userDid} (bypassing cooldown)`
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
          `[AUTO_BACKFILL_FEEDS] Starting background backfill for ${userDid}`
        );

        await this.backfillFeedSubscriptions(userDid);

        // Update last backfill timestamp
        await db
          .insert(userSettings)
          .values({
            userDid,
            lastFeedsBackfill: new Date(),
          })
          .onConflictDoUpdate({
            target: userSettings.userDid,
            set: {
              lastFeedsBackfill: new Date(),
            },
          });

        console.log(`[AUTO_BACKFILL_FEEDS] Complete for ${userDid}!`);
      } catch (error) {
        console.error(
          `[AUTO_BACKFILL_FEEDS] Fatal error for ${userDid}:`,
          error
        );
      } finally {
        ongoingBackfills.delete(userDid);
      }
    })();
  }

  /**
   * Backfill feed generator subscriptions from user's PDS
   */
  private async backfillFeedSubscriptions(userDid: string): Promise<void> {
    try {
      // Resolve the user's DID to find their PDS endpoint
      const { didResolver } = await import('./did-resolver');
      const didDoc = await didResolver.resolveDID(userDid);

      if (!didDoc) {
        console.error(
          `[AUTO_BACKFILL_FEEDS] Could not resolve DID ${userDid}`
        );
        return;
      }

      // Find PDS service endpoint
      const services = (didDoc as any).service || [];
      const pdsService = services.find(
        (s: any) =>
          s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
      );

      if (!pdsService?.serviceEndpoint) {
        console.error(
          `[AUTO_BACKFILL_FEEDS] No PDS endpoint found for ${userDid}`
        );
        return;
      }

      const userPdsEndpoint = pdsService.serviceEndpoint;
      console.log(
        `[AUTO_BACKFILL_FEEDS] Using PDS endpoint: ${userPdsEndpoint}`
      );

      const agent = new AtpAgent({ service: userPdsEndpoint });
      const eventProcessor = new EventProcessor(storage);
      eventProcessor.setSkipPdsFetching(true);
      eventProcessor.setSkipDataCollectionCheck(true);

      let feedsFetched = 0;

      // Fetch user's feed generator records (their subscriptions)
      console.log(
        `[AUTO_BACKFILL_FEEDS] Listing feed generator records for ${userDid}`
      );

      try {
        // Fetch the user's preferences to get saved feeds
        const prefsResponse = await agent.app.bsky.actor.getPreferences();
        const savedFeeds = prefsResponse.data.preferences
          .filter((pref: any) => pref.$type === 'app.bsky.actor.defs#savedFeedsPref')
          .flatMap((pref: any) => pref.saved || []);

        console.log(
          `[AUTO_BACKFILL_FEEDS] Found ${savedFeeds.length} saved feed subscriptions`
        );

        // For each saved feed, fetch the feed generator record
        for (const feedUri of savedFeeds) {
          try {
            // Parse the feed URI to get repo and rkey
            // Format: at://did/app.bsky.feed.generator/rkey
            const parts = feedUri.split('/');
            if (parts.length < 4) {
              console.error(
                `[AUTO_BACKFILL_FEEDS] Invalid feed URI format: ${feedUri}`
              );
              continue;
            }

            const feedCreatorDid = parts[2];
            const collection = parts[3];
            const rkey = parts[4];

            // Resolve feed creator's DID to find their PDS
            const feedCreatorDidDoc = await didResolver.resolveDID(
              feedCreatorDid
            );
            if (!feedCreatorDidDoc) {
              continue;
            }

            const feedCreatorServices = (feedCreatorDidDoc as any).service || [];
            const feedCreatorPdsService = feedCreatorServices.find(
              (s: any) =>
                s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
            );

            if (!feedCreatorPdsService?.serviceEndpoint) {
              continue;
            }

            // Fetch the feed generator record from the creator's PDS
            const feedAgent = new AtpAgent({
              service: feedCreatorPdsService.serviceEndpoint,
            });

            const feedRecord = await feedAgent.com.atproto.repo.getRecord({
              repo: feedCreatorDid,
              collection: collection,
              rkey: rkey,
            });

            if (feedRecord.data.value) {
              // Process the feed generator record
              await eventProcessor.processCommit({
                repo: feedCreatorDid,
                ops: [
                  {
                    action: 'create',
                    path: `${collection}/${rkey}`,
                    cid: feedRecord.data.cid,
                    record: feedRecord.data.value,
                  },
                ],
                time: new Date().toISOString(),
                rev: '',
              } as any);

              feedsFetched++;
            }
          } catch (error: any) {
            if (
              error.status === 404 ||
              error.message?.includes('not found')
            ) {
              // Feed doesn't exist, skip silently
            } else {
              console.error(
                `[AUTO_BACKFILL_FEEDS] Error fetching feed ${feedUri}:`,
                error.message
              );
            }
          }
        }

        console.log(
          `[AUTO_BACKFILL_FEEDS] Fetched ${feedsFetched} feed generators`
        );
      } catch (error: any) {
        console.error(
          `[AUTO_BACKFILL_FEEDS] Error fetching preferences:`,
          error.message || error
        );
      }
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FEEDS] Error backfilling feeds:`,
        error
      );
    }
  }
}

// Singleton instance
export const autoBackfillFeedsService = new AutoBackfillFeedsService();
