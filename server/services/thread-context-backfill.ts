/**
 * Thread Context Backfill Service
 * Automatically fetches missing parent/root posts to prevent broken conversations
 * Uses Bluesky's public AppView for discovery, then fetches actual records from PDSs
 */

import { AtpAgent } from '@atproto/api';
import { storage } from '../storage';
import { db } from '../db';
import { posts } from '@shared/schema';
import { sql } from 'drizzle-orm';
import { EventProcessor } from './event-processor';

const BSKY_APPVIEW = 'https://public.api.bsky.app';
const BATCH_SIZE = 50;
const CONCURRENT_FETCHES = 10;

// Track posts being processed to prevent duplicates
const processingPosts = new Set<string>();

export class ThreadContextBackfillService {
  /**
   * Check all posts in database for missing parent/root posts and backfill them
   */
  async backfillMissingThreadContext(): Promise<{
    checked: number;
    missing: number;
    fetched: number;
  }> {
    console.log('[THREAD_CONTEXT] Starting thread context scan...');

    // Find all posts that have parent_uri or root_uri but those posts don't exist
    const missingParents = await db.execute(sql`
      SELECT DISTINCT p.parent_uri as uri
      FROM ${posts} p
      LEFT JOIN ${posts} parent ON p.parent_uri = parent.uri
      WHERE p.parent_uri IS NOT NULL
        AND parent.uri IS NULL
      LIMIT 1000
    `);

    const missingRoots = await db.execute(sql`
      SELECT DISTINCT p.root_uri as uri
      FROM ${posts} p
      LEFT JOIN ${posts} root ON p.root_uri = root.uri
      WHERE p.root_uri IS NOT NULL
        AND root.uri IS NULL
        AND p.root_uri != p.parent_uri
      LIMIT 1000
    `);

    const missingUris = new Set<string>();
    missingParents.rows.forEach((row: any) => {
      if (row.uri) missingUris.add(row.uri);
    });
    missingRoots.rows.forEach((row: any) => {
      if (row.uri) missingUris.add(row.uri);
    });

    console.log(
      `[THREAD_CONTEXT] Found ${missingUris.size} missing thread posts`
    );

    if (missingUris.size === 0) {
      return { checked: 0, missing: 0, fetched: 0 };
    }

    // Fetch missing posts
    let fetched = 0;
    const uriArray = Array.from(missingUris);

    for (let i = 0; i < uriArray.length; i += BATCH_SIZE) {
      const batch = uriArray.slice(i, i + BATCH_SIZE);
      const batchFetched = await this.fetchPostBatch(batch);
      fetched += batchFetched;

      if ((i + BATCH_SIZE) % 200 === 0) {
        console.log(
          `[THREAD_CONTEXT] Progress: ${i + BATCH_SIZE}/${uriArray.length} checked, ${fetched} fetched`
        );
      }
    }

    console.log(
      `[THREAD_CONTEXT] Complete: ${uriArray.length} missing, ${fetched} fetched`
    );

    return { checked: uriArray.length, missing: missingUris.size, fetched };
  }

  /**
   * Backfill thread context for a specific post
   * Fetches parent and root posts if they don't exist
   */
  async backfillPostContext(postUri: string): Promise<number> {
    // Avoid duplicate processing
    if (processingPosts.has(postUri)) {
      return 0;
    }

    processingPosts.add(postUri);

    try {
      // Get the post from our database
      const post = await storage.getPost(postUri);
      if (!post) {
        return 0;
      }

      const missingUris: string[] = [];

      // Check if parent exists
      if (post.parentUri) {
        const parent = await storage.getPost(post.parentUri);
        if (!parent) {
          missingUris.push(post.parentUri);
        }
      }

      // Check if root exists (and is different from parent)
      if (post.rootUri && post.rootUri !== post.parentUri) {
        const root = await storage.getPost(post.rootUri);
        if (!root) {
          missingUris.push(post.rootUri);
        }
      }

      if (missingUris.length === 0) {
        return 0;
      }

      console.log(
        `[THREAD_CONTEXT] Post ${postUri} has ${missingUris.length} missing context posts`
      );

      return await this.fetchPostBatch(missingUris);
    } finally {
      processingPosts.delete(postUri);
    }
  }

  /**
   * Fetch a batch of posts from Bluesky AppView, then fetch actual records from PDSs
   */
  private async fetchPostBatch(postUris: string[]): Promise<number> {
    if (postUris.length === 0) return 0;

    const bskyAgent = new AtpAgent({ service: BSKY_APPVIEW });
    const { didResolver } = await import('./did-resolver');
    const eventProcessor = new EventProcessor(storage);
    eventProcessor.setSkipPdsFetching(true);
    eventProcessor.setSkipDataCollectionCheck(true);

    let fetched = 0;

    // Process in concurrent chunks
    for (let i = 0; i < postUris.length; i += CONCURRENT_FETCHES) {
      const chunk = postUris.slice(i, i + CONCURRENT_FETCHES);

      await Promise.all(
        chunk.map(async (postUri) => {
          try {
            // First, try to get post info from Bluesky AppView
            const postThread = await bskyAgent.app.bsky.feed.getPostThread({
              uri: postUri,
              depth: 0, // Just get this post, not replies
            });

            if (
              !postThread.data.thread ||
              postThread.data.thread.$type !== 'app.bsky.feed.defs#threadViewPost'
            ) {
              return;
            }

            const postView = (postThread.data.thread as any).post;
            if (!postView) return;

            // Parse the post URI to get repo and rkey
            const parts = postUri.split('/');
            if (parts.length < 4) return;

            const authorDid = parts[2];
            const collection = parts[3];
            const rkey = parts[4];

            // Resolve author's DID to find their PDS
            const authorDidDoc = await didResolver.resolveDID(authorDid);
            if (!authorDidDoc) return;

            const services = (authorDidDoc as any).service || [];
            const pdsService = services.find(
              (s: any) =>
                s.type === 'AtprotoPersonalDataServer' || s.id === '#atproto_pds'
            );

            if (!pdsService?.serviceEndpoint) return;

            // Fetch the actual post record from author's PDS
            const authorAgent = new AtpAgent({
              service: pdsService.serviceEndpoint,
            });

            const postRecord = await authorAgent.com.atproto.repo.getRecord({
              repo: authorDid,
              collection: collection,
              rkey: rkey,
            });

            if (postRecord.data.value) {
              // Process the post record
              await eventProcessor.processCommit({
                repo: authorDid,
                ops: [
                  {
                    action: 'create',
                    path: `${collection}/${rkey}`,
                    cid: postRecord.data.cid,
                    record: postRecord.data.value,
                  },
                ],
                time: new Date().toISOString(),
                rev: '',
              } as any);

              fetched++;

              // If this post also has missing context, recursively fetch it
              const fetchedPost = postRecord.data.value as any;
              if (fetchedPost.reply) {
                if (fetchedPost.reply.parent?.uri) {
                  const parentExists = await storage.getPost(
                    fetchedPost.reply.parent.uri
                  );
                  if (!parentExists) {
                    // Queue parent for fetching (don't wait)
                    this.fetchPostBatch([fetchedPost.reply.parent.uri]).catch(
                      (err) =>
                        console.error(
                          '[THREAD_CONTEXT] Error fetching parent:',
                          err
                        )
                    );
                  }
                }

                if (
                  fetchedPost.reply.root?.uri &&
                  fetchedPost.reply.root.uri !== fetchedPost.reply.parent?.uri
                ) {
                  const rootExists = await storage.getPost(
                    fetchedPost.reply.root.uri
                  );
                  if (!rootExists) {
                    // Queue root for fetching (don't wait)
                    this.fetchPostBatch([fetchedPost.reply.root.uri]).catch(
                      (err) =>
                        console.error(
                          '[THREAD_CONTEXT] Error fetching root:',
                          err
                        )
                    );
                  }
                }
              }
            }
          } catch (error: any) {
            if (error.status === 404 || error.message?.includes('not found')) {
              // Post doesn't exist, skip silently
            } else {
              console.error(
                `[THREAD_CONTEXT] Error fetching post ${postUri}:`,
                error.message
              );
            }
          }
        })
      );
    }

    return fetched;
  }

  /**
   * Periodic background job to scan for and backfill missing thread context
   * Call this from a cron job or periodic task
   */
  async runPeriodicScan(): Promise<void> {
    console.log('[THREAD_CONTEXT] Starting periodic scan...');

    try {
      const result = await this.backfillMissingThreadContext();
      console.log(
        `[THREAD_CONTEXT] Periodic scan complete: checked ${result.checked}, fetched ${result.fetched}`
      );
    } catch (error) {
      console.error('[THREAD_CONTEXT] Error in periodic scan:', error);
    }
  }
}

// Singleton instance
export const threadContextBackfillService =
  new ThreadContextBackfillService();
