/**
 * Feed Generator Discovery Service
 *
 * Fetches feed generators that were created before this AppView started indexing,
 * providing an alternative to full relay backfill for discovering generators.
 *
 * Methods:
 * 1. Query official Bluesky AppView for popular/suggested feed generators
 * 2. Scan repositories of known users for app.bsky.feed.generator records
 * 3. Accept manual feed URIs for indexing
 */

import { didResolver } from './did-resolver';
import { eventProcessor } from './event-processor';
import { smartConsole } from './console-wrapper';
import { storage } from '../storage';

interface FeedGeneratorRecord {
  uri: string;
  cid: string;
  did: string;
  displayName: string;
  description?: string;
  avatar?: string;
  createdAt: string;
}

interface DiscoveryStats {
  discovered: number;
  indexed: number;
  failed: number;
  skipped: number;
}

export class FeedGeneratorDiscovery {
  private isRunning = false;
  private stats: DiscoveryStats = {
    discovered: 0,
    indexed: 0,
    failed: 0,
    skipped: 0,
  };

  // Track when we last scanned each user to avoid duplicate scans
  private lastScanned = new Map<string, number>();
  private readonly SCAN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Discover all users who have published feed generators
   * by querying our own database for known feed generator creators
   */
  async getKnownFeedGeneratorCreators(): Promise<string[]> {
    try {
      const creators = await storage.getDistinctFeedGeneratorCreators();
      smartConsole.log(
        `[FEEDGEN_DISCOVERY] Found ${creators.length} known feed generator creators in database`
      );
      return creators;
    } catch (error) {
      smartConsole.error(
        `[FEEDGEN_DISCOVERY] Error getting known creators:`,
        error
      );
      return [];
    }
  }

  /**
   * Discover feed generators by listing records from a specific user's repository
   * Uses com.atproto.repo.listRecords to enumerate all app.bsky.feed.generator records
   */
  async discoverFromUserRepository(
    did: string
  ): Promise<FeedGeneratorRecord[]> {
    try {
      smartConsole.log(
        `[FEEDGEN_DISCOVERY] Scanning repository ${did} for feed generators...`
      );

      // Resolve the user's PDS endpoint
      const pdsEndpoint = await didResolver.resolveDIDToPDS(did);
      if (!pdsEndpoint) {
        smartConsole.warn(
          `[FEEDGEN_DISCOVERY] Could not resolve PDS for ${did}`
        );
        return [];
      }

      const feedGenerators: FeedGeneratorRecord[] = [];
      let cursor: string | undefined;

      // List all app.bsky.feed.generator records for this user
      do {
        const url = new URL(`${pdsEndpoint}/xrpc/com.atproto.repo.listRecords`);
        url.searchParams.set('repo', did);
        url.searchParams.set('collection', 'app.bsky.feed.generator');
        url.searchParams.set('limit', '100');
        if (cursor) {
          url.searchParams.set('cursor', cursor);
        }

        const response = await fetch(url.toString(), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          smartConsole.warn(
            `[FEEDGEN_DISCOVERY] PDS returned ${response.status} for ${did}`
          );
          break;
        }

        const data = await response.json();

        if (data.records && Array.isArray(data.records)) {
          for (const record of data.records) {
            feedGenerators.push({
              uri: record.uri,
              cid: record.cid,
              did: record.value.did,
              displayName: record.value.displayName,
              description: record.value.description,
              avatar: record.value.avatar,
              createdAt: record.value.createdAt,
            });
          }
        }

        cursor = data.cursor;
      } while (cursor);

      smartConsole.log(
        `[FEEDGEN_DISCOVERY] Found ${feedGenerators.length} feed generators from ${did}`
      );
      return feedGenerators;
    } catch (error) {
      smartConsole.error(
        `[FEEDGEN_DISCOVERY] Error discovering from user ${did}:`,
        error
      );
      return [];
    }
  }

  /**
   * Fetch a specific feed generator by its AT URI
   */
  async fetchFeedGeneratorByUri(
    uri: string
  ): Promise<FeedGeneratorRecord | null> {
    try {
      // Parse the URI: at://did:plc:xxx/app.bsky.feed.generator/rkey
      const parts = uri.split('/');
      if (parts.length < 5) {
        smartConsole.warn(
          `[FEEDGEN_DISCOVERY] Invalid feed generator URI: ${uri}`
        );
        return null;
      }

      const did = parts[2];
      const collection = parts[3];
      const rkey = parts[4];

      if (collection !== 'app.bsky.feed.generator') {
        smartConsole.warn(
          `[FEEDGEN_DISCOVERY] URI is not a feed generator: ${uri}`
        );
        return null;
      }

      // Resolve the PDS endpoint
      const pdsEndpoint = await didResolver.resolveDIDToPDS(did);
      if (!pdsEndpoint) {
        smartConsole.warn(
          `[FEEDGEN_DISCOVERY] Could not resolve PDS for ${did}`
        );
        return null;
      }

      // Fetch the record
      const url = `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;

      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        smartConsole.warn(
          `[FEEDGEN_DISCOVERY] PDS returned ${response.status} for ${uri}`
        );
        return null;
      }

      const data = await response.json();

      if (data.uri && data.cid && data.value) {
        return {
          uri: data.uri,
          cid: data.cid,
          did: data.value.did,
          displayName: data.value.displayName,
          description: data.value.description,
          avatar: data.value.avatar,
          createdAt: data.value.createdAt,
        };
      }

      return null;
    } catch (error) {
      smartConsole.error(
        `[FEEDGEN_DISCOVERY] Error fetching feed generator ${uri}:`,
        error
      );
      return null;
    }
  }

  /**
   * Index a feed generator into the database
   */
  private async indexFeedGenerator(
    feedGen: FeedGeneratorRecord
  ): Promise<boolean> {
    try {
      // Check if it already exists
      const existing = await storage.getFeedGenerator(feedGen.uri);
      if (existing) {
        smartConsole.log(
          `[FEEDGEN_DISCOVERY] Feed generator already indexed: ${feedGen.uri}`
        );
        this.stats.skipped++;
        return true;
      }

      // Parse the URI to get the creator DID
      const parts = feedGen.uri.split('/');
      const creatorDid = parts[2];

      // Process the feed generator through the event processor
      await eventProcessor.processRecord(feedGen.uri, feedGen.cid, creatorDid, {
        $type: 'app.bsky.feed.generator',
        did: feedGen.did,
        displayName: feedGen.displayName,
        description: feedGen.description,
        avatar: feedGen.avatar,
        createdAt: feedGen.createdAt,
      });

      smartConsole.log(
        `[FEEDGEN_DISCOVERY] Indexed feed generator: ${feedGen.uri} (${feedGen.displayName})`
      );
      this.stats.indexed++;
      return true;
    } catch (error) {
      smartConsole.error(
        `[FEEDGEN_DISCOVERY] Error indexing feed generator ${feedGen.uri}:`,
        error
      );
      this.stats.failed++;
      return false;
    }
  }

  /**
   * Run discovery from multiple sources
   */
  async runDiscovery(
    options: {
      fromKnownCreators?: boolean;
      fromSpecificUsers?: string[];
      specificUris?: string[];
    } = {}
  ): Promise<DiscoveryStats> {
    if (this.isRunning) {
      throw new Error('Discovery is already running');
    }

    this.isRunning = true;
    this.stats = {
      discovered: 0,
      indexed: 0,
      failed: 0,
      skipped: 0,
    };

    try {
      smartConsole.log(
        `[FEEDGEN_DISCOVERY] Starting feed generator discovery...`
      );

      const allFeedGenerators: FeedGeneratorRecord[] = [];

      // Discover from known feed generator creators already in our database
      // This refreshes their feeds to catch any new ones they've published
      if (options.fromKnownCreators) {
        const knownCreators = await this.getKnownFeedGeneratorCreators();
        smartConsole.log(
          `[FEEDGEN_DISCOVERY] Scanning ${knownCreators.length} known creators for new feeds...`
        );

        for (const did of knownCreators) {
          const userFeeds = await this.discoverFromUserRepository(did);
          allFeedGenerators.push(...userFeeds);
        }
      }

      // Discover from specific users' repositories (e.g., curated list of popular feed creators)
      if (options.fromSpecificUsers && options.fromSpecificUsers.length > 0) {
        smartConsole.log(
          `[FEEDGEN_DISCOVERY] Scanning ${options.fromSpecificUsers.length} specific users...`
        );

        for (const did of options.fromSpecificUsers) {
          const userFeeds = await this.discoverFromUserRepository(did);
          allFeedGenerators.push(...userFeeds);
        }
      }

      // Fetch specific feed URIs directly
      if (options.specificUris && options.specificUris.length > 0) {
        smartConsole.log(
          `[FEEDGEN_DISCOVERY] Fetching ${options.specificUris.length} specific feed URIs...`
        );

        for (const uri of options.specificUris) {
          const feedGen = await this.fetchFeedGeneratorByUri(uri);
          if (feedGen) {
            allFeedGenerators.push(feedGen);
          }
        }
      }

      this.stats.discovered = allFeedGenerators.length;
      smartConsole.log(
        `[FEEDGEN_DISCOVERY] Discovered ${this.stats.discovered} feed generators total`
      );

      // Index all discovered feed generators
      for (const feedGen of allFeedGenerators) {
        await this.indexFeedGenerator(feedGen);
      }

      smartConsole.log(`[FEEDGEN_DISCOVERY] Discovery complete:`, this.stats);
      return { ...this.stats };
    } catch (error) {
      smartConsole.error(`[FEEDGEN_DISCOVERY] Error during discovery:`, error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get discovery statistics
   */
  getStats(): DiscoveryStats {
    return { ...this.stats };
  }

  /**
   * Check if discovery is currently running
   */
  isDiscoveryRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Auto-discover all feed generators from a creator when we encounter one
   * This runs in the background and won't block the firehose
   */
  async autoDiscoverFromCreator(creatorDid: string): Promise<void> {
    try {
      // Check if we've scanned this user recently
      const lastScan = this.lastScanned.get(creatorDid);
      if (lastScan && Date.now() - lastScan < this.SCAN_COOLDOWN_MS) {
        // Already scanned recently, skip
        return;
      }

      // Mark as scanned
      this.lastScanned.set(creatorDid, Date.now());

      smartConsole.log(
        `[FEEDGEN_DISCOVERY] Auto-discovering feeds from creator: ${creatorDid}`
      );

      // Discover all feeds from this creator in the background
      const feeds = await this.discoverFromUserRepository(creatorDid);

      // Index each discovered feed
      for (const feed of feeds) {
        await this.indexFeedGenerator(feed);
      }

      if (feeds.length > 0) {
        smartConsole.log(
          `[FEEDGEN_DISCOVERY] Auto-discovered ${feeds.length} feeds from ${creatorDid}`
        );
      }
    } catch (error) {
      smartConsole.error(
        `[FEEDGEN_DISCOVERY] Error auto-discovering from ${creatorDid}:`,
        error
      );
    }
  }

  /**
   * Clear scan cooldown for a specific user (for manual refreshes)
   */
  clearScanCooldown(creatorDid: string): void {
    this.lastScanned.delete(creatorDid);
  }

  /**
   * Clear all scan cooldowns
   */
  clearAllScanCooldowns(): void {
    this.lastScanned.clear();
  }
}

export const feedGeneratorDiscovery = new FeedGeneratorDiscovery();
