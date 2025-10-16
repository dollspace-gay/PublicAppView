/**
 * Quote Posts Backfill Service
 * Automatically fetches posts that quote existing posts in the database
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

export class QuotePostsBackfillService {
  /**
   * Scan database for posts and backfill their quote posts
   */
  async backfillQuotePosts(): Promise<{
    checked: number;
    quotes: number;
    fetched: number;
  }> {
    console.log('[QUOTE_POSTS] Starting quote posts scan...');

    // Get posts to check for quotes (prioritize recent posts)
    const postsToCheck = await db
      .select({ uri: posts.uri })
      .from(posts)
      .orderBy(sql`${posts.createdAt} DESC`)
      .limit(500); // Check last 500 posts

    console.log(`[QUOTE_POSTS] Checking ${postsToCheck.length} posts for quotes`);

    let totalQuotesFound = 0;
    let totalQuotesFetched = 0;

    for (let i = 0; i < postsToCheck.length; i += BATCH_SIZE) {
      const batch = postsToCheck.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (post) => {
          try {
            const result = await this.fetchQuotesForPost(post.uri);
            totalQuotesFound += result.quotesFound;
            totalQuotesFetched += result.quotesFetched;
          } catch (error: any) {
            console.error(
              `[QUOTE_POSTS] Error fetching quotes for ${post.uri}:`,
              error.message
            );
          }
        })
      );

      if ((i + BATCH_SIZE) % 100 === 0) {
        console.log(
          `[QUOTE_POSTS] Progress: ${i + BATCH_SIZE}/${postsToCheck.length} posts checked, ${totalQuotesFound} quotes found, ${totalQuotesFetched} fetched`
        );
      }
    }

    console.log(
      `[QUOTE_POSTS] Complete: ${postsToCheck.length} posts checked, ${totalQuotesFound} quotes found, ${totalQuotesFetched} fetched`
    );

    return {
      checked: postsToCheck.length,
      quotes: totalQuotesFound,
      fetched: totalQuotesFetched,
    };
  }

  /**
   * Fetch quote posts for a specific post
   */
  async fetchQuotesForPost(
    postUri: string
  ): Promise<{ quotesFound: number; quotesFetched: number }> {
    // Avoid duplicate processing
    if (processingPosts.has(postUri)) {
      return { quotesFound: 0, quotesFetched: 0 };
    }

    processingPosts.add(postUri);

    try {
      const bskyAgent = new AtpAgent({ service: BSKY_APPVIEW });

      // Query Bluesky AppView for posts that quote this post
      let quotesFound = 0;
      let quotesFetched = 0;
      let cursor: string | undefined;

      do {
        try {
          const response = await bskyAgent.app.bsky.feed.getQuotes({
            uri: postUri,
            limit: 50,
            cursor,
          });

          if (!response.data.posts || response.data.posts.length === 0) {
            break;
          }

          quotesFound += response.data.posts.length;

          // Fetch quote posts in chunks
          const quoteUris = response.data.posts.map((p: any) => p.uri);

          for (let i = 0; i < quoteUris.length; i += CONCURRENT_FETCHES) {
            const chunk = quoteUris.slice(i, i + CONCURRENT_FETCHES);
            const fetchedCount = await this.fetchQuotePostBatch(chunk);
            quotesFetched += fetchedCount;
          }

          cursor = response.data.cursor;
        } catch (error: any) {
          if (error.status === 404 || error.message?.includes('not found')) {
            // Post doesn't exist or has no quotes
            break;
          }
          console.error(
            `[QUOTE_POSTS] Error querying quotes for ${postUri}:`,
            error.message
          );
          break;
        }
      } while (cursor);

      return { quotesFound, quotesFetched };
    } finally {
      processingPosts.delete(postUri);
    }
  }

  /**
   * Fetch a batch of quote posts from their PDSs
   */
  private async fetchQuotePostBatch(quoteUris: string[]): Promise<number> {
    if (quoteUris.length === 0) return 0;

    const { didResolver } = await import('./did-resolver');
    const eventProcessor = new EventProcessor(storage);
    eventProcessor.setSkipPdsFetching(true);
    eventProcessor.setSkipDataCollectionCheck(true);

    let fetched = 0;

    await Promise.all(
      quoteUris.map(async (quoteUri) => {
        try {
          // Check if we already have this post
          const existingPost = await storage.getPost(quoteUri);
          if (existingPost) {
            return; // Already have it
          }

          // Parse the quote URI to get repo and rkey
          const parts = quoteUri.split('/');
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

          // Fetch the actual quote post record from author's PDS
          const authorAgent = new AtpAgent({
            service: pdsService.serviceEndpoint,
          });

          const postRecord = await authorAgent.com.atproto.repo.getRecord({
            repo: authorDid,
            collection: collection,
            rkey: rkey,
          });

          if (postRecord.data.value) {
            // Process the quote post record
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

            // If this quote post also quotes something, recursively fetch it
            const quoteRecord = postRecord.data.value as any;
            if (quoteRecord.embed?.record?.uri) {
              const embeddedUri = quoteRecord.embed.record.uri;
              const embeddedPost = await storage.getPost(embeddedUri);

              if (!embeddedPost) {
                // Queue the embedded post for fetching (don't wait)
                this.fetchQuotePostBatch([embeddedUri]).catch((err) =>
                  console.error(
                    '[QUOTE_POSTS] Error fetching embedded post:',
                    err
                  )
                );
              }
            }
          }
        } catch (error: any) {
          if (
            error.status === 404 ||
            error.message?.includes('not found') ||
            error.message?.includes('Could not locate record')
          ) {
            // Post was deleted, skip silently
          } else {
            console.error(
              `[QUOTE_POSTS] Error fetching quote post ${quoteUri}:`,
              error.message
            );
          }
        }
      })
    );

    return fetched;
  }

  /**
   * Backfill quote posts for a specific user
   * Finds all posts by the user and fetches their quote posts
   */
  async backfillQuotePostsForUser(
    userDid: string
  ): Promise<{ checked: number; quotes: number; fetched: number }> {
    console.log(`[QUOTE_POSTS] Backfilling quote posts for ${userDid}`);

    // Get user's posts
    const userPosts = await db
      .select({ uri: posts.uri })
      .from(posts)
      .where(sql`${posts.authorDid} = ${userDid}`)
      .orderBy(sql`${posts.createdAt} DESC`)
      .limit(200); // Check last 200 posts

    console.log(
      `[QUOTE_POSTS] Checking ${userPosts.length} posts for user ${userDid}`
    );

    let totalQuotesFound = 0;
    let totalQuotesFetched = 0;

    for (const post of userPosts) {
      try {
        const result = await this.fetchQuotesForPost(post.uri);
        totalQuotesFound += result.quotesFound;
        totalQuotesFetched += result.quotesFetched;
      } catch (error: any) {
        console.error(
          `[QUOTE_POSTS] Error fetching quotes for ${post.uri}:`,
          error.message
        );
      }
    }

    console.log(
      `[QUOTE_POSTS] Complete for ${userDid}: ${userPosts.length} posts checked, ${totalQuotesFound} quotes found, ${totalQuotesFetched} fetched`
    );

    return {
      checked: userPosts.length,
      quotes: totalQuotesFound,
      fetched: totalQuotesFetched,
    };
  }

  /**
   * Periodic background job to scan for and backfill quote posts
   * Call this from a cron job or periodic task
   */
  async runPeriodicScan(): Promise<void> {
    console.log('[QUOTE_POSTS] Starting periodic scan...');

    try {
      const result = await this.backfillQuotePosts();
      console.log(
        `[QUOTE_POSTS] Periodic scan complete: checked ${result.checked}, found ${result.quotes} quotes, fetched ${result.fetched}`
      );
    } catch (error) {
      console.error('[QUOTE_POSTS] Error in periodic scan:', error);
    }
  }
}

// Singleton instance
export const quotePostsBackfillService = new QuotePostsBackfillService();
