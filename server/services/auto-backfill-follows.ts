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
const CONCURRENT_FETCHES = 50; // Increased from 10 to 50 for faster processing
const PDS_HOST = process.env.PDS_HOST || 'https://bsky.network';
const BACKFILL_COOLDOWN_HOURS = 1; // Cooldown before re-running automatic backfill
const PDS_REQUEST_TIMEOUT = 10000; // 10 second timeout per PDS request
const MAX_FOLLOW_RECORDS_TO_CHECK = 500; // Don't paginate through more than 500 follows per user

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

      console.log(`[AUTO_BACKFILL_FOLLOWS] Triggering backfill for ${userDid}`);

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

        console.log(`[AUTO_BACKFILL_FOLLOWS] Complete for ${userDid}!`);
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
   *
   * Part 1: Fetch outgoing follows from user's PDS (proper ATProto)
   * Part 2: Fetch incoming followers from Bluesky public AppView, then fetch
   *         the actual follow records from each follower's PDS
   */
  private async backfillFollowRelationships(userDid: string): Promise<void> {
    const eventProcessor = new EventProcessor(storage);
    eventProcessor.setSkipPdsFetching(true);
    eventProcessor.setSkipDataCollectionCheck(true);

    // PART 1: Fetch outgoing follows from user's PDS
    let followingFetched = 0;
    try {
      const { didResolver } = await import('./did-resolver');
      const didDoc = await didResolver.resolveDID(userDid);

      if (!didDoc) {
        console.error(
          `[AUTO_BACKFILL_FOLLOWS] Could not resolve DID ${userDid}`
        );
      } else {
        const services = (didDoc as any).service || [];
        const pdsService = services.find(
          (s: any) =>
            s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
        );

        if (!pdsService?.serviceEndpoint) {
          console.error(
            `[AUTO_BACKFILL_FOLLOWS] No PDS endpoint found for ${userDid}`
          );
        } else {
          const userPdsEndpoint = pdsService.serviceEndpoint;
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Fetching outgoing follows from PDS: ${userPdsEndpoint}`
          );

          const agent = new AtpAgent({ service: userPdsEndpoint });
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
                `[AUTO_BACKFILL_FOLLOWS] Found ${response.data.records.length} outgoing follow records`
              );

              for (const record of response.data.records) {
                try {
                  // Use the original createdAt from the follow record for proper ordering
                  const createdAt =
                    record.value?.createdAt || new Date().toISOString();

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
                    time: createdAt,
                    rev: '',
                  } as any);

                  followingFetched++;
                } catch (error: any) {
                  console.error(
                    `[AUTO_BACKFILL_FOLLOWS] Error processing outgoing follow:`,
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
              break;
            }
          } while (cursor);
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetched ${followingFetched} outgoing follows`
      );
    } catch (error) {
      console.error(
        `[AUTO_BACKFILL_FOLLOWS] Error backfilling outgoing follows:`,
        error
      );
    }

    // PART 2: Fetch incoming followers via Bluesky public AppView
    let followersFetched = 0;
    try {
      const bskyAppView = 'https://public.api.bsky.app';
      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetching followers list from Bluesky AppView: ${bskyAppView}`
      );

      const bskyAgent = new AtpAgent({ service: bskyAppView });
      let cursor: string | undefined;
      const followerDids: string[] = [];

      // First, collect all follower DIDs from Bluesky AppView
      do {
        try {
          const response = await bskyAgent.app.bsky.graph.getFollowers({
            actor: userDid,
            limit: 100,
            cursor: cursor,
          });

          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Found ${response.data.followers.length} followers in this batch`
          );

          for (const follower of response.data.followers) {
            followerDids.push(follower.did);
          }

          cursor = response.data.cursor;
        } catch (error: any) {
          console.error(
            `[AUTO_BACKFILL_FOLLOWS] Error fetching followers from Bluesky:`,
            error.message || error
          );
          break;
        }
      } while (cursor);

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Found ${followerDids.length} total followers, fetching their follow records...`
      );

      // Now fetch the actual follow records from each follower's PDS
      const { didResolver } = await import('./did-resolver');
      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < followerDids.length; i += CONCURRENT_FETCHES) {
        const batch = followerDids.slice(i, i + CONCURRENT_FETCHES);

        await Promise.all(
          batch.map(async (followerDid) => {
            try {
              // Resolve follower's DID to find their PDS
              const followerDidDoc = await didResolver.resolveDID(followerDid);
              if (!followerDidDoc) {
                failedCount++;
                return;
              }

              const services = (followerDidDoc as any).service || [];
              const pdsService = services.find(
                (s: any) =>
                  s.type === 'AtprotoPersonalDataServer' ||
                  s.id === '#atproto_pds'
              );

              if (!pdsService?.serviceEndpoint) {
                failedCount++;
                return;
              }

              // List their follow records to find the one pointing to userDid
              // IMPORTANT: Paginate through ALL records, not just first 100
              const followerAgent = new AtpAgent({
                service: pdsService.serviceEndpoint,
              });

              let followRecord: any = null;
              let followCursor: string | undefined;
              let recordsChecked = 0;

              // Paginate through follow records to find the one pointing to userDid
              // Limit pagination to prevent getting stuck on users who follow thousands
              do {
                const records =
                  await followerAgent.com.atproto.repo.listRecords({
                    repo: followerDid,
                    collection: 'app.bsky.graph.follow',
                    limit: 100,
                    cursor: followCursor,
                  });

                recordsChecked += records.data.records.length;

                // Find the follow record pointing to our user
                followRecord = records.data.records.find(
                  (r: any) => r.value?.subject === userDid
                );

                if (followRecord) {
                  break; // Found it, stop paginating
                }

                followCursor = records.data.cursor;

                // Safety limit: don't check more than MAX_FOLLOW_RECORDS_TO_CHECK records
                if (recordsChecked >= MAX_FOLLOW_RECORDS_TO_CHECK) {
                  console.warn(
                    `[AUTO_BACKFILL_FOLLOWS] Hit pagination limit for ${followerDid} (checked ${recordsChecked} records)`
                  );
                  break;
                }
              } while (followCursor && !followRecord);

              if (followRecord) {
                // Use the original createdAt from the follow record for proper ordering
                const createdAt =
                  followRecord.value?.createdAt || new Date().toISOString();

                await eventProcessor.processCommit({
                  repo: followerDid,
                  ops: [
                    {
                      action: 'create',
                      path: `app.bsky.graph.follow/${followRecord.uri.split('/').pop()}`,
                      cid: followRecord.cid,
                      record: followRecord.value,
                    },
                  ],
                  time: createdAt,
                  rev: '',
                } as any);

                followersFetched++;
                successCount++;
              } else {
                // Follow record not found - log for debugging
                console.warn(
                  `[AUTO_BACKFILL_FOLLOWS] No follow record found from ${followerDid} to ${userDid}`
                );
                failedCount++;
              }
            } catch (error: any) {
              if (
                error.status === 404 ||
                error.message?.includes('not found')
              ) {
                // User or record doesn't exist
                console.warn(
                  `[AUTO_BACKFILL_FOLLOWS] User/record not found for ${followerDid}: ${error.message}`
                );
              } else if (
                error.status === 400 &&
                error.message?.includes('Could not find repo')
              ) {
                // Repo doesn't exist (account deleted/suspended)
                console.warn(
                  `[AUTO_BACKFILL_FOLLOWS] Repo not found for ${followerDid} (likely deleted/suspended)`
                );
              } else if (
                error.code === 'ECONNREFUSED' ||
                error.code === 'ETIMEDOUT'
              ) {
                // PDS connection issues
                console.error(
                  `[AUTO_BACKFILL_FOLLOWS] PDS connection error for ${followerDid}: ${error.code}`
                );
              } else {
                // Unexpected error - log full details
                console.error(
                  `[AUTO_BACKFILL_FOLLOWS] Unexpected error fetching follow record from ${followerDid}:`,
                  {
                    message: error.message,
                    status: error.status,
                    code: error.code,
                  }
                );
              }
              failedCount++;
            }
          })
        );

        if (
          (i + CONCURRENT_FETCHES) % 100 === 0 ||
          i + CONCURRENT_FETCHES >= followerDids.length
        ) {
          console.log(
            `[AUTO_BACKFILL_FOLLOWS] Follower progress: ${successCount}/${followerDids.length} (${failedCount} failed)`
          );
        }
      }

      console.log(
        `[AUTO_BACKFILL_FOLLOWS] Fetched ${followersFetched} incoming follower records`
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
        console.log(
          `[AUTO_BACKFILL_FOLLOWS] No related users to fetch profiles for`
        );
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
