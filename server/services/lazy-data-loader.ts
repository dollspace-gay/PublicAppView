/**
 * Lazy Data Loader Service
 * 
 * Fetches missing data on-demand when feeds are requested,
 * then saves it to the database for future requests.
 */

import { didResolver } from "./did-resolver";
import { eventProcessor } from "./event-processor";
import { storage } from "../storage";
import { pdsDataFetcher } from "./pds-data-fetcher";

interface PDSRecord {
  uri: string;
  cid: string;
  value: any;
}

interface ListRecordsResponse {
  records: PDSRecord[];
  cursor?: string;
}

export class LazyDataLoader {
  private readonly FETCH_TIMEOUT_MS = 10000; // 10 seconds
  private readonly POSTS_TO_FETCH_PER_USER = 50; // Fetch 50 recent posts per followed user
  
  /**
   * Ensure user's follows are in the database
   * Fetches from PDS if missing
   */
  async ensureUserFollows(userDid: string, accessToken: string): Promise<void> {
    try {
      // Check if we have follows for this user
      const existingFollows = await storage.getFollows(userDid);
      
      if (existingFollows.length > 0) {
        console.log(`[LAZY_LOAD] User ${userDid} already has ${existingFollows.length} follows in DB`);
        return; // Already have follows
      }

      console.log(`[LAZY_LOAD] Fetching follows for ${userDid} from PDS`);
      
      const pdsEndpoint = await didResolver.resolveDIDToPDS(userDid);
      if (!pdsEndpoint) {
        console.error(`[LAZY_LOAD] Could not resolve PDS endpoint for ${userDid}`);
        return;
      }

      // Fetch follows from PDS
      const follows = await this.fetchRecordsFromPDS(
        pdsEndpoint,
        accessToken,
        userDid,
        'app.bsky.graph.follow',
        100 // Fetch up to 100 follows
      );

      console.log(`[LAZY_LOAD] Fetched ${follows.length} follows for ${userDid}`);

      // Process each follow record
      for (const record of follows) {
        try {
          await eventProcessor.processRecord(
            record.uri,
            record.cid,
            userDid,
            record.value
          );
        } catch (error) {
          console.error(`[LAZY_LOAD] Error processing follow ${record.uri}:`, error);
        }
      }
    } catch (error) {
      console.error(`[LAZY_LOAD] Error ensuring follows for ${userDid}:`, error);
    }
  }

  /**
   * Ensure we have recent posts for users in the timeline
   * Fetches from PDS if missing
   */
  async ensureRecentPostsForUsers(userDids: string[], requesterDid: string): Promise<void> {
    try {
      console.log(`[LAZY_LOAD] Checking posts for ${userDids.length} users`);
      
      for (const targetDid of userDids) {
        try {
          // Check if we have recent posts for this user
          const existingPosts = await storage.getUserPosts(targetDid, 10);
          
          if (existingPosts.length >= 5) {
            // We have enough recent posts
            continue;
          }

          console.log(`[LAZY_LOAD] Fetching posts for ${targetDid} (only ${existingPosts.length} in DB)`);

          // Resolve the target user's PDS
          const pdsEndpoint = await didResolver.resolveDIDToPDS(targetDid);
          if (!pdsEndpoint) {
            console.error(`[LAZY_LOAD] Could not resolve PDS for ${targetDid}`);
            // Mark incomplete so background fetcher can try later
            pdsDataFetcher.markIncomplete('user', targetDid);
            continue;
          }

          // Fetch posts from their PDS (no auth token needed for public posts)
          const posts = await this.fetchRecordsFromPDS(
            pdsEndpoint,
            '', // No auth token - public data
            targetDid,
            'app.bsky.feed.post',
            this.POSTS_TO_FETCH_PER_USER
          );

          console.log(`[LAZY_LOAD] Fetched ${posts.length} posts for ${targetDid}`);

          // Process each post record
          for (const record of posts) {
            try {
              await eventProcessor.processRecord(
                record.uri,
                record.cid,
                targetDid,
                record.value
              );
            } catch (error) {
              console.error(`[LAZY_LOAD] Error processing post ${record.uri}:`, error);
            }
          }
        } catch (error) {
          console.error(`[LAZY_LOAD] Error fetching posts for ${targetDid}:`, error);
        }
      }
    } catch (error) {
      console.error(`[LAZY_LOAD] Error ensuring posts:`, error);
    }
  }

  /**
   * Ensure user profile exists in database
   */
  async ensureUserProfile(userDid: string): Promise<void> {
    try {
      // Check if user exists
      const existingUser = await storage.getUser(userDid);
      if (existingUser && existingUser.handle !== userDid) {
        // User exists with real handle (not placeholder)
        return;
      }

      console.log(`[LAZY_LOAD] Fetching profile for ${userDid}`);

      const pdsEndpoint = await didResolver.resolveDIDToPDS(userDid);
      if (!pdsEndpoint) {
        console.error(`[LAZY_LOAD] Could not resolve PDS for ${userDid}`);
        return;
      }

      // Fetch profile from PDS (public data)
      const profileRecords = await this.fetchRecordsFromPDS(
        pdsEndpoint,
        '',
        userDid,
        'app.bsky.actor.profile',
        1
      );

      if (profileRecords.length > 0) {
        const record = profileRecords[0];
        await eventProcessor.processRecord(
          record.uri,
          record.cid,
          userDid,
          record.value
        );
        console.log(`[LAZY_LOAD] Loaded profile for ${userDid}`);
      } else {
        // No profile record, create minimal user
        const handle = await didResolver.resolveDIDToHandle(userDid);
        await storage.updateUser(userDid, {
          handle: handle || userDid,
          displayName: null,
          description: null,
          avatarUrl: null,
          bannerUrl: null,
        });
      }
    } catch (error) {
      console.error(`[LAZY_LOAD] Error ensuring profile for ${userDid}:`, error);
    }
  }

  /**
   * Fetch records from a PDS using com.atproto.repo.listRecords
   */
  private async fetchRecordsFromPDS(
    pdsEndpoint: string,
    accessToken: string,
    repo: string,
    collection: string,
    limit: number
  ): Promise<PDSRecord[]> {
    try {
      const params = new URLSearchParams({
        repo,
        collection,
        limit: limit.toString(),
      });

      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?${params.toString()}`;
      
      const headers: HeadersInit = {
        'Accept': 'application/json',
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        // 400 with empty collection is normal
        if (response.status === 400) {
          const errorText = await response.text();
          if (errorText.includes('Could not find collection')) {
            return []; // Collection doesn't exist for this user
          }
        }
        
        console.warn(`[LAZY_LOAD] Failed to fetch ${collection}: ${response.status}`);
        return [];
      }

      const data: ListRecordsResponse = await response.json();
      return data.records || [];
    } catch (error) {
      console.error(`[LAZY_LOAD] Error fetching from PDS:`, error);
      return [];
    }
  }
}

export const lazyDataLoader = new LazyDataLoader();
