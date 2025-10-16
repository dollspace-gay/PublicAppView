/**
 * Backfill posts that a user has liked but don't exist in our database yet
 * This is common after importing a CAR file - you have the like records but not the posts
 */

import { AtpAgent } from '@atproto/api';
import { storage } from '../storage';
import { EventProcessor } from '../services/event-processor';

const BATCH_SIZE = 100;
const CONCURRENT_FETCHES = 10;
const PDS_HOST = process.env.PDS_HOST || 'https://bsky.network';

async function backfillLikedPosts(userDid: string) {
  console.log(`[BACKFILL] Starting backfill of liked posts for ${userDid}`);

  // Get all post URIs from likes that don't have corresponding posts
  const missingPosts = await storage.db.execute(
    storage.sql`
      SELECT DISTINCT l.post_uri
      FROM ${storage.schema.likes} l
      LEFT JOIN ${storage.schema.posts} p ON l.post_uri = p.uri
      WHERE l.user_did = ${userDid} AND p.uri IS NULL
      LIMIT 10000
    `
  );

  const missingPostUris = missingPosts.rows.map((row: any) => row.post_uri);

  console.log(
    `[BACKFILL] Found ${missingPostUris.length} liked posts that need to be fetched`
  );

  if (missingPostUris.length === 0) {
    console.log('[BACKFILL] No missing posts to backfill!');
    return;
  }

  // Create agent to fetch posts
  const agent = new AtpAgent({ service: PDS_HOST });

  // Create event processor to process the fetched posts
  const eventProcessor = new EventProcessor(storage);
  eventProcessor.setSkipPdsFetching(true);
  eventProcessor.setSkipDataCollectionCheck(true);

  let fetchedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  // Process in batches
  for (let i = 0; i < missingPostUris.length; i += BATCH_SIZE) {
    const batch = missingPostUris.slice(i, i + BATCH_SIZE);

    console.log(
      `[BACKFILL] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(missingPostUris.length / BATCH_SIZE)} (${batch.length} posts)`
    );

    // Fetch posts in parallel chunks
    const chunks = [];
    for (let j = 0; j < batch.length; j += CONCURRENT_FETCHES) {
      chunks.push(batch.slice(j, j + CONCURRENT_FETCHES));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (postUri) => {
          try {
            // Fetch the post from the network
            const response = await agent.app.bsky.feed.post.get({
              repo: postUri.split('/')[2], // Extract DID from URI
              rkey: postUri.split('/').pop()!, // Extract record key
            });

            if (!response.value) {
              console.log(`[BACKFILL] Post not found: ${postUri}`);
              skippedCount++;
              return;
            }

            // Process the post through event processor
            await eventProcessor.processCommit({
              repo: postUri.split('/')[2],
              ops: [
                {
                  action: 'create',
                  path: `app.bsky.feed.post/${postUri.split('/').pop()}`,
                  cid: response.cid,
                  record: response.value,
                },
              ],
              time: new Date().toISOString(),
              rev: '',
            } as any);

            fetchedCount++;

            if (fetchedCount % 100 === 0) {
              console.log(
                `[BACKFILL] Progress: ${fetchedCount} fetched, ${failedCount} failed, ${skippedCount} skipped`
              );
            }
          } catch (error: any) {
            if (error.status === 404) {
              skippedCount++;
            } else {
              console.error(
                `[BACKFILL] Error fetching ${postUri}:`,
                error.message
              );
              failedCount++;
            }
          }
        })
      );
    }
  }

  console.log(
    `[BACKFILL] Complete! ${fetchedCount} fetched, ${failedCount} failed, ${skippedCount} not found`
  );
}

// Get user DID from command line or environment
const userDid = process.argv[2] || process.env.USER_DID;

if (!userDid) {
  console.error('Usage: tsx server/scripts/backfill-liked-posts.ts <user-did>');
  console.error(
    '   or: USER_DID=did:plc:xxx tsx server/scripts/backfill-liked-posts.ts'
  );
  process.exit(1);
}

backfillLikedPosts(userDid)
  .then(() => {
    console.log('[BACKFILL] Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[BACKFILL] Fatal error:', error);
    process.exit(1);
  });
