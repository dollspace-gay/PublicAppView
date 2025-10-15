import { Pool } from 'pg';

export interface EnrichedEvent {
  // Original firehose event data
  type: 'commit' | 'identity' | 'account';
  seq?: string;
  time: string;

  // Commit event fields
  repo?: string;
  ops?: Array<{
    action: 'create' | 'update' | 'delete';
    path: string;
    cid?: string;
    record?: unknown;
  }>;

  // Enriched metadata
  enriched?: {
    author?: {
      handle?: string;
      displayName?: string;
      description?: string;
      followersCount?: number;
      followsCount?: number;
      postsCount?: number;
    };
    timestamp: number;
  };
}

export class EventEnricher {
  private pool: Pool | null = null;
  private enrichWithProfiles: boolean;
  private enrichWithHandles: boolean;
  private profileCache: Map<string, any> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache

  constructor(
    databaseUrl: string | undefined,
    options: {
      enrichWithProfiles?: boolean;
      enrichWithHandles?: boolean;
    } = {}
  ) {
    if (databaseUrl) {
      this.pool = new Pool({ connectionString: databaseUrl });
    }

    this.enrichWithProfiles = options.enrichWithProfiles ?? true;
    this.enrichWithHandles = options.enrichWithHandles ?? true;
  }

  async enrich(event: {
    type: string;
    seq?: string;
    data?: Record<string, unknown>;
  }): Promise<EnrichedEvent> {
    const enriched: EnrichedEvent = {
      type: event.type,
      seq: event.seq,
      time: new Date().toISOString(),
      ...event.data,
    };

    // Only enrich commit events with repo information
    if (event.type === 'commit' && event.data?.repo && this.pool) {
      const authorDid = event.data.repo;

      try {
        // Check cache first
        const cached = this.profileCache.get(authorDid);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
          enriched.enriched = {
            author: cached.data,
            timestamp: Date.now(),
          };
          return enriched;
        }

        // Query database for user profile
        const result = await this.pool.query(
          `SELECT 
            handle,
            display_name as "displayName",
            description,
            followers_count as "followersCount",
            follows_count as "followsCount",
            posts_count as "postsCount"
          FROM users
          WHERE did = $1
          LIMIT 1`,
          [authorDid]
        );

        if (result.rows.length > 0) {
          const author = result.rows[0];

          // Filter based on enrichment settings
          const enrichedAuthor: Record<string, unknown> = {};

          if (this.enrichWithHandles && author.handle) {
            enrichedAuthor.handle = author.handle;
          }

          if (this.enrichWithProfiles) {
            if (author.displayName)
              enrichedAuthor.displayName = author.displayName;
            if (author.description)
              enrichedAuthor.description = author.description;
            enrichedAuthor.followersCount = author.followersCount || 0;
            enrichedAuthor.followsCount = author.followsCount || 0;
            enrichedAuthor.postsCount = author.postsCount || 0;
          }

          enriched.enriched = {
            author: enrichedAuthor,
            timestamp: Date.now(),
          };

          // Cache the result
          this.profileCache.set(authorDid, {
            data: enrichedAuthor,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        console.error(
          `[ENRICHER] Error enriching event for ${authorDid}:`,
          error
        );
      }
    }

    return enriched;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  clearCache(): void {
    this.profileCache.clear();
  }
}
