/**
 * Login Data Sync Service
 * 
 * Fetches recent user data from their PDS when they log in
 * to ensure the appview has the latest activity from the past 3 days
 */

import { didResolver } from "./did-resolver";
import { eventProcessor } from "./event-processor";

interface PDSRecord {
  uri: string;
  cid: string;
  value: any;
}

interface ListRecordsResponse {
  records: PDSRecord[];
  cursor?: string;
}

export class LoginDataSyncService {
  private readonly DAYS_TO_FETCH = 3;
  private readonly FETCH_TIMEOUT_MS = 30000; // 30 seconds
  
  // Collections to sync on login
  private readonly COLLECTIONS_TO_SYNC = [
    'app.bsky.actor.profile',
    'app.bsky.feed.like',
    'app.bsky.feed.post',
    'app.bsky.feed.postgate',
    'app.bsky.feed.repost',
    'app.bsky.feed.threadgate',
    'app.bsky.graph.block',
    'app.bsky.graph.follow',
    'app.bsky.graph.listblock',
    // Note: app.bsky.notification.declaration is not a standard collection yet
  ];

  /**
   * Sync recent data for a user from their PDS
   * This is called on login to fetch the last 3 days of activity
   */
  async syncRecentUserData(userDid: string, accessToken: string): Promise<void> {
    try {
      console.log(`[LOGIN_SYNC] Starting data sync for ${userDid} (last ${this.DAYS_TO_FETCH} days)`);
      
      // Resolve user's PDS endpoint
      const pdsEndpoint = await didResolver.resolveDIDToPDS(userDid);
      if (!pdsEndpoint) {
        console.error(`[LOGIN_SYNC] Could not resolve PDS endpoint for ${userDid}`);
        return;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.DAYS_TO_FETCH);

      // Fetch records from each collection
      for (const collection of this.COLLECTIONS_TO_SYNC) {
        try {
          await this.syncCollection(
            userDid,
            pdsEndpoint,
            accessToken,
            collection,
            cutoffDate
          );
        } catch (error) {
          console.error(`[LOGIN_SYNC] Error syncing ${collection} for ${userDid}:`, error);
          // Continue with other collections even if one fails
        }
      }

      console.log(`[LOGIN_SYNC] Completed data sync for ${userDid}`);
    } catch (error) {
      console.error(`[LOGIN_SYNC] Error syncing data for ${userDid}:`, error);
    }
  }

  /**
   * Sync a specific collection for a user
   */
  private async syncCollection(
    userDid: string,
    pdsEndpoint: string,
    accessToken: string,
    collection: string,
    cutoffDate: Date
  ): Promise<void> {
    let cursor: string | undefined;
    let recordCount = 0;
    let recentRecordCount = 0;
    const maxPages = 100; // Safety limit to prevent infinite loops
    let pageCount = 0;

    do {
      if (pageCount >= maxPages) {
        console.warn(`[LOGIN_SYNC] Reached max page limit for ${collection}`);
        break;
      }

      try {
        const response = await this.fetchRecordsPage(
          pdsEndpoint,
          accessToken,
          userDid,
          collection,
          cursor
        );

        if (!response || !response.records || response.records.length === 0) {
          break;
        }

        // Process each record
        for (const record of response.records) {
          recordCount++;

          // Check if record is within our date range
          const recordDate = this.extractRecordDate(record.value);
          if (recordDate && recordDate < cutoffDate) {
            // Records are typically returned in reverse chronological order
            // Once we hit an old record, we can stop for this collection
            console.log(`[LOGIN_SYNC] Reached records older than ${this.DAYS_TO_FETCH} days for ${collection}, stopping`);
            cursor = undefined; // Stop pagination
            break;
          }

          // Process the record through the event processor
          try {
            await eventProcessor.processRecord(
              record.uri,
              record.cid,
              userDid,
              record.value
            );
            recentRecordCount++;
          } catch (error) {
            console.error(`[LOGIN_SYNC] Error processing record ${record.uri}:`, error);
          }
        }

        cursor = response.cursor;
        pageCount++;

        // Small delay between pages to avoid overwhelming the PDS
        if (cursor && pageCount < maxPages) {
          await this.sleep(100);
        }
      } catch (error) {
        console.error(`[LOGIN_SYNC] Error fetching page for ${collection}:`, error);
        break;
      }
    } while (cursor);

    if (recentRecordCount > 0) {
      console.log(`[LOGIN_SYNC] Synced ${recentRecordCount}/${recordCount} recent records from ${collection}`);
    }
  }

  /**
   * Fetch a page of records from a PDS collection
   */
  private async fetchRecordsPage(
    pdsEndpoint: string,
    accessToken: string,
    repo: string,
    collection: string,
    cursor?: string
  ): Promise<ListRecordsResponse | null> {
    try {
      const params = new URLSearchParams({
        repo,
        collection,
        limit: '100', // Max batch size
      });

      if (cursor) {
        params.append('cursor', cursor);
      }

      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?${params.toString()}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(this.FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        // 400 with empty collection is normal - just means no records
        if (response.status === 400) {
          const errorText = await response.text();
          if (errorText.includes('Could not find collection')) {
            return null; // Collection doesn't exist for this user
          }
        }
        
        console.warn(`[LOGIN_SYNC] Failed to fetch ${collection}: ${response.status}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`[LOGIN_SYNC] Error fetching records:`, error);
      return null;
    }
  }

  /**
   * Extract the creation date from a record
   */
  private extractRecordDate(record: any): Date | null {
    try {
      // Most AT Protocol records have a createdAt field
      if (record.createdAt) {
        return new Date(record.createdAt);
      }

      // Some records might use different fields
      if (record.createdDate) {
        return new Date(record.createdDate);
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const loginDataSyncService = new LoginDataSyncService();
