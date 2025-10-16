/**
 * Automatic Backfill Service for Follows and Profile Information
 * Backfills missing follow relationships and profile info for follows/followers
 */

import { AtpAgent } from '@atproto/api';
import { storage } from '../storage';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { follows, users, userSettings } from '@shared/schema';
import { EventProcessor } from './event-processor';

const BATCH_SIZE = 100;
const CONCURRENT_FETCHES = 10;
const PDS_HOST = process.env.PDS_HOST || 'https://bsky.network';
const BACKFILL_COOLDOWN_HOURS = 1; // Cooldown before re-running automatic backfill

// Track ongoing backfills to prevent duplicates
const ongoingBackfills = new Set<string>();

export class AutoBackfillFollowsService {
  /**
   * Check if a user needs follows backfilled and trigger it if needed
   * Called automatically on login
   */
  async checkAndBackfill(userDid: string): Promise<boolean> {
    // Skip if already backfilling for this user
    if (ongoingBackfills.has(userDid)) {
      console.log(`[AUTO_BACKFILL_FOLLOWS] Already backfilling for ${userDid}`);
      return false;
    }

    try {
      // Check cooldown - don't backfill if we did it recently
      const settings = await db.query.userSettings.findFirst({
        where: (s, { eq }) => eq(s.userDid, userDid),
      });

      if (settings?.lastFollowsBackfill) {
        const hoursSinceLastBackfill =
          (Date.now() - settings.lastFollowsBackfill.getTime()) /
          (1000 * 60 * 60);

        if (hoursSinceLastBackfill < BACKFILL_COOLDOWN_HOURS) {
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Skipping ${userDid} - backfilled ${Math.round(hoursSinceLastBackfill)}h ago`
          );
          return false;
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Triggering backfill for ${userDid}`
      );

      // Trigger backfill in background
      this.backfillInBackground(userDid);

      return true;
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error checking user ${userDid}:`,
        error
      );
      return false;
    }
  }

  /**
   * Manually trigger backfill bypassing cooldown checks
   * Used for manual user-initiated backfills
   */
  async forceBackfill(userDid: string): Promise<boolean> {
    // Skip if already backfilling for this user
    if (ongoingBackfills.has(userDid)) {
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Already backfilling for ${userDid} - skipping force trigger`
      );
      return false;
    }

    console.log(
      `[AUTO_BACKFILL_FOLLOWS] Force backfill triggered for ${userDid} (bypassing cooldown)`
    );

    // Trigger backfill in background without cooldown check
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
          `[AUTO_BACKFILL_FOLLOWS] Starting background backfill for ${userDid}`
        );

        // Step 1: Backfill follow relationships from PDS
        await this.backfillFollowRelationships(userDid);

        // Step 2: Backfill profile info for all related users
        await this.backfillProfileInfo(userDid);

        // Update last backfill timestamp
        await db
          .insert(userSettings)
          .values({
            userDid,
            lastFollowsBackfill: new Date(),
          })
          .onConflictDoUpdate({
            target: userSettings.userDid,
            set: {
              lastFollowsBackfill: new Date(),
            },
          });

        console.log(
          `[AUTO_BACKFILL_FOLLOWS] Complete for ${userDid}!`
        );
      } catch (error) {
        console.error(
          `[AUTO_BACKFILL_FOLLOWS] Fatal error for ${userDid}:`,
          error
        );
      } finally {
        ongoingBackfills.delete(userDid);
      }
    })();
  }

  /**
   * Backfill follow relationships (who user follows and who follows them)
   * NOTE: We can only backfill who the user follows (outgoing follows) by listing
   * their repo records. We cannot backfill who follows them (incoming follows) without
   * scanning the entire network or having that data come through the firehose.
   */
  private async backfillFollowRelationships(userDid: string): Promise<void> {
    try {
      // Resolve the user's DID to find their PDS endpoint
      const { didResolver } = await import('./did-resolver');
      const didDoc = await didResolver.resolveDID(userDid);

      if (!didDoc) {
        console.error(
          `[AUTO_BACKFILL_FOLLOWS] Could not resolve DID ${userDid}`
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
          `[AUTO_BACKFILL_FOLLOWS] No PDS endpoint found for ${userDid}`
        );
        return;
      }

      const userPdsEndpoint = pdsService.serviceEndpoint;
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Using PDS endpoint: ${userPdsEndpoint}`
      );

      const agent = new AtpAgent({ service: userPdsEndpoint });
      const eventProcessor = new EventProcessor(storage);
      eventProcessor.setSkipPdsFetching(true);
      eventProcessor.setSkipDataCollectionCheck(true);

      let followingFetched = 0;

      // Fetch who the user follows by listing their follow records
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Listing follow records for ${userDid}`
      );
      let cursor: string | undefined;
      do {
        try {
          const response = await agent.com.atproto.repo.listRecords({
            repo: userDid,
            collection: 'app.bsky.graph.follow',
            limit: 100,
            cursor: cursor,
          });

          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Found ${response.data.records.length} follow records in this batch`
          );

          for (const record of response.data.records) {
            try {
              // Process the follow record
              await eventProcessor.processCommit({
                repo: userDid,
                ops: [
                  {
                    action: 'create',
                    path: `app.bsky.graph.follow/${record.uri.split('/').pop()}`,
                    cid: record.cid,
                    record: record.value,
                  },
                ],
                time: new Date().toISOString(),
                rev: '',
              } as any);

              followingFetched++;
            } catch (error: any) {
              console.error(
                `[AUTO_BACKFILL_FOLLOWS] Error processing follow record:`,
                error.message
              );
            }
          }

          cursor = response.data.cursor;
        } catch (error: any) {
          console.error(
            `[AUTO_BACKFILL_FOLLOWS] Error listing follow records:`,
            error.message || error
          );
          if (error.status) {
            console.error(
              `[AUTO_BACKFILL_FOLLOWS] HTTP Status: ${error.status}`
            );
          }
          break;
        }
      } while (cursor);

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetched ${followingFetched} follows from user's PDS`
      );

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Note: Incoming followers can only be discovered through the firehose`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error backfilling relationships:`,
        error
      );
    }
  }

  /**
   * Backfill profile info for all users related to this user (follows + followers)
   */
  private async backfillProfileInfo(userDid: string): Promise<void> {
    try {
      // Get all related user DIDs (people user follows + people who follow user)
      const relatedDids = await db.execute(
        sql`
          SELECT DISTINCT following_did as did
          FROM ${follows}
          WHERE follower_did = ${userDid}
          UNION
          SELECT DISTINCT follower_did as did
          FROM ${follows}
          WHERE following_did = ${userDid}
        `
      );

      const didsToFetch = relatedDids.rows.map((row: any) => row.did);

      if (didsToFetch.length === 0) {
        console.log(`[AUTO_BACKFILL_FOLLOWS] No related users to fetch profiles for`);
        return;
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetching profiles for ${didsToFetch.length} related users`
      );

      // Check which users don't have profile info yet
      const existingUsers = await storage.getUsers(didsToFetch);
      const existingDids = new Set(existingUsers.map((u) => u.did));
      const missingDids = didsToFetch.filter((did) => !existingDids.has(did));

      if (missingDids.length === 0) {
        console.log(
          `[AUTO_BACKFILL_FOLLOWS] All related users already have profiles`
        );
        return;
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetching ${missingDids.length} missing profiles`
      );

      const agent = new AtpAgent({ service: PDS_HOST });
      const eventProcessor = new EventProcessor(storage);
      eventProcessor.setSkipPdsFetching(true);
      eventProcessor.setSkipDataCollectionCheck(true);

      let fetchedCount = 0;
      let failedCount = 0;

      // Process in batches
      for (let i = 0; i < missingDids.length; i += BATCH_SIZE) {
        const batch = missingDids.slice(i, i + BATCH_SIZE);

        // Fetch in parallel chunks
        const chunks = [];
        for (let j = 0; j < batch.length; j += CONCURRENT_FETCHES) {
          chunks.push(batch.slice(j, j + CONCURRENT_FETCHES));
        }

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (did: string) => {
              try {
                // Resolve DID to find PDS endpoint
                const { didResolver } = await import('./did-resolver');
                const didDoc = await didResolver.resolveDID(did);

                if (!didDoc) {
                  failedCount++;
                  return;
                }

                // Find PDS service endpoint
                const services = (didDoc as any).service || [];
                const pdsService = services.find(
                  (s: any) =>
                    s.type === 'AtprotoPersonalDataServer' ||
                    s.id === '#atproto_pds'
                );

                if (!pdsService?.serviceEndpoint) {
                  failedCount++;
                  return;
                }

                // Create agent for this specific PDS
                const pdsAgent = new AtpAgent({
                  service: pdsService.serviceEndpoint,
                });

                // Fetch the profile record
                const response = await pdsAgent.com.atproto.repo.getRecord({
                  repo: did,
                  collection: 'app.bsky.actor.profile',
                  rkey: 'self',
                });

                if (!response.data.value) {
                  failedCount++;
                  return;
                }

                // Process the profile
                await eventProcessor.processCommit({
                  repo: did,
                  ops: [
                    {
                      action: 'create',
                      path: 'app.bsky.actor.profile/self',
                      cid: response.data.cid,
                      record: response.data.value,
                    },
                  ],
                  time: new Date().toISOString(),
                  rev: '',
                } as any);

                fetchedCount++;

                if (fetchedCount % 100 === 0) {
                  console.log(
                    `[AUTO_BACKFILL_FOLLOWS] Profile progress: ${fetchedCount}/${missingDids.length} (${failedCount} failed)`
                  );
                }
              } catch (error: any) {
                if (
                  error.status === 404 ||
                  error.message?.includes('not found')
                ) {
                  // Profile doesn't exist, skip silently
                } else {
                  console.error(
                    `[AUTO_BACKFILL_FOLLOWS] Error fetching profile ${did}:`,
                    error.message
                  );
                }
                failedCount++;
              }
            })
          );
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Profile backfill complete: ${fetchedCount} fetched, ${failedCount} failed`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error backfilling profiles:`,
        error
      );
    }
  }
}

// Singleton instance
export const autoBackfillFollowsService = new AutoBackfillFollowsService();
