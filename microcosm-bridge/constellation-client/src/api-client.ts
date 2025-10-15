/**
 * Constellation API Client
 *
 * HTTP client for interacting with Constellation's backlink index API.
 * Provides methods to query interaction counts across the AT Protocol network.
 */

interface ConstellationConfig {
  baseUrl: string;
  timeout?: number;
  userAgent?: string;
  maxRequestsPerSecond?: number;
}

interface LinksCounts {
  [collection: string]: {
    [path: string]: number;
  };
}

export class ConstellationAPIClient {
  private baseUrl: string;
  private timeout: number;
  private userAgent: string;
  private lastRequestTime: number = 0;
  private minRequestInterval: number;

  constructor(config: ConstellationConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.timeout = config.timeout || 5000;
    this.userAgent = config.userAgent || 'AppView-Constellation-Bridge/1.0';

    // Rate limiting: ensure we don't exceed max requests per second
    const maxRps = config.maxRequestsPerSecond || 10;
    this.minRequestInterval = 1000 / maxRps;
  }

  /**
   * Rate limiting helper - ensures minimum interval between requests
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Generic fetch wrapper with timeout and error handling
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    await this.rateLimit();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Constellation API request timeout after ${this.timeout}ms`
        );
      }
      throw error;
    }
  }

  /**
   * Get count of backlinks to a target from specified collection/path
   *
   * @param target - AT-URI, DID, or URL to query
   * @param collection - Source NSID (e.g., 'app.bsky.feed.like')
   * @param path - JSON path in source documents (e.g., '.subject.uri')
   * @returns Number of backlinks
   */
  async getLinksCount(
    target: string,
    collection: string,
    path: string
  ): Promise<number> {
    const url =
      `${this.baseUrl}/links/count?` +
      `target=${encodeURIComponent(target)}` +
      `&collection=${encodeURIComponent(collection)}` +
      `&path=${encodeURIComponent(path)}`;

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(
          `Constellation API error: ${response.status} ${response.statusText}`
        );
      }

      const text = await response.text();
      let count: number;

      // Try to parse as JSON first (new API format)
      try {
        const json = JSON.parse(text);
        if (typeof json === 'object' && 'total' in json) {
          count = parseInt(String(json.total), 10);
        } else {
          throw new Error('JSON response missing total field');
        }
      } catch {
        // Fall back to plain text number (old API format)
        count = parseInt(text.trim(), 10);
      }

      if (isNaN(count)) {
        throw new Error(`Invalid response from Constellation API: ${text}`);
      }

      return count;
    } catch (error) {
      console.error('[CONSTELLATION] Error fetching links count:', error);
      throw error;
    }
  }

  /**
   * Get all backlinks to a target (any collection/path)
   *
   * @param target - AT-URI, DID, or URL to query
   * @returns Object mapping collection → path → count
   */
  async getAllLinksCount(target: string): Promise<LinksCounts> {
    const url = `${this.baseUrl}/links/all/count?target=${encodeURIComponent(target)}`;

    try {
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(
          `Constellation API error: ${response.status} ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      console.error('[CONSTELLATION] Error fetching all links count:', error);
      throw error;
    }
  }

  /**
   * Convenience method: Get like count for a Bluesky post
   */
  async getPostLikes(postUri: string): Promise<number> {
    return this.getLinksCount(postUri, 'app.bsky.feed.like', '.subject.uri');
  }

  /**
   * Convenience method: Get repost count for a Bluesky post
   */
  async getPostReposts(postUri: string): Promise<number> {
    return this.getLinksCount(postUri, 'app.bsky.feed.repost', '.subject.uri');
  }

  /**
   * Convenience method: Get reply count for a Bluesky post
   */
  async getPostReplies(postUri: string): Promise<number> {
    return this.getLinksCount(
      postUri,
      'app.bsky.feed.post',
      '.reply.parent.uri'
    );
  }

  /**
   * Convenience method: Get quote post count for a Bluesky post
   */
  async getPostQuotes(postUri: string): Promise<number> {
    return this.getLinksCount(
      postUri,
      'app.bsky.feed.post',
      '.embed.record.uri'
    );
  }

  /**
   * Convenience method: Get follower count for a DID
   */
  async getFollowers(did: string): Promise<number> {
    return this.getLinksCount(did, 'app.bsky.graph.follow', '.subject');
  }

  /**
   * Convenience method: Get mention count for a DID
   */
  async getMentions(did: string): Promise<number> {
    return this.getLinksCount(
      did,
      'app.bsky.feed.post',
      '.facets[].features[].did'
    );
  }

  /**
   * Health check - verify API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try a simple query to verify API is up
      const response = await fetch(`${this.baseUrl}/`, {
        method: 'HEAD',
        headers: {
          'User-Agent': this.userAgent,
        },
      });
      return response.ok;
    } catch (error) {
      console.error('[CONSTELLATION] Health check failed:', error);
      return false;
    }
  }
}

export type { ConstellationConfig, LinksCounts };
