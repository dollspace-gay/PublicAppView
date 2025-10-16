import type {
  GetProfileRequest,
  GetProfilesRequest,
  SearchActorsRequest,
  GetAuthorFeedRequest,
  GetTimelineRequest,
  GetPostThreadRequest,
  GetPostRequest,
  GetPostsRequest,
  ProfileRecord,
  FeedItemRecord,
  PostRecord,
  ThreadRecord,
  PaginatedResponse,
} from '../server/types';

/**
 * Data-Plane Client
 *
 * This client is used by the AppView layer to query the data-plane.
 * It handles:
 * - HTTP requests to internal data-plane endpoints
 * - Response caching (TODO: add Redis caching)
 * - Error handling and retries
 * - Request batching (TODO)
 */
export class DataPlaneClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl?: string, timeout: number = 5000) {
    this.baseUrl =
      baseUrl || process.env.DATA_PLANE_URL || 'http://localhost:5001';
    this.timeout = timeout;
  }

  /**
   * Internal request method
   */
  private async request<T>(
    endpoint: string,
    body: any,
    options: { timeout?: number; retries?: number } = {}
  ): Promise<T> {
    const { timeout = this.timeout, retries = 2 } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: 'Unknown error' }));
          throw new Error(
            `Data-plane error: ${error.error || response.statusText}`
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 4xx errors
        if (
          lastError.message.includes('400') ||
          lastError.message.includes('404')
        ) {
          throw lastError;
        }

        // Retry on network errors or 5xx errors
        if (attempt < retries) {
          const backoff = Math.min(100 * Math.pow(2, attempt), 1000);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  // Profile queries

  async getProfile(actor: string): Promise<ProfileRecord> {
    return this.request<ProfileRecord>('/internal/getProfile', { actor });
  }

  async getProfiles(actors: string[]): Promise<{ profiles: ProfileRecord[] }> {
    return this.request<{ profiles: ProfileRecord[] }>(
      '/internal/getProfiles',
      { actors }
    );
  }

  async searchActors(
    query: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<PaginatedResponse<ProfileRecord>> {
    return this.request<PaginatedResponse<ProfileRecord>>(
      '/internal/searchActors',
      {
        query,
        ...options,
      }
    );
  }

  // Feed queries

  async getAuthorFeed(
    actor: string,
    options: {
      filter?: 'posts_with_replies' | 'posts_no_replies' | 'posts_with_media';
      limit?: number;
      cursor?: string;
    } = {}
  ): Promise<PaginatedResponse<FeedItemRecord>> {
    return this.request<PaginatedResponse<FeedItemRecord>>(
      '/internal/getAuthorFeed',
      {
        actor,
        ...options,
      }
    );
  }

  async getTimeline(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<PaginatedResponse<FeedItemRecord>> {
    return this.request<PaginatedResponse<FeedItemRecord>>(
      '/internal/getTimeline',
      {
        actor,
        ...options,
      }
    );
  }

  async getPostThread(
    uri: string,
    options: { depth?: number; parentHeight?: number; viewerDid?: string } = {}
  ): Promise<ThreadRecord> {
    return this.request<ThreadRecord>('/internal/getPostThread', {
      uri,
      ...options,
    });
  }

  async getPost(uri: string): Promise<PostRecord> {
    return this.request<PostRecord>('/internal/getPost', { uri });
  }

  async getPosts(uris: string[]): Promise<{ posts: PostRecord[] }> {
    return this.request<{ posts: PostRecord[] }>('/internal/getPosts', {
      uris,
    });
  }

  // Graph queries (placeholders - to be implemented)

  async getFollowers(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getFollowers', { actor, ...options });
  }

  async getFollows(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getFollows', { actor, ...options });
  }

  async getRelationships(actor: string, others: string[]): Promise<any> {
    return this.request('/internal/getRelationships', { actor, others });
  }

  async getBlocks(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getBlocks', { actor, ...options });
  }

  async getMutes(
    actor: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<any> {
    return this.request('/internal/getMutes', { actor, ...options });
  }

  // Search queries (placeholders)

  async searchPosts(
    query: string,
    options: {
      author?: string;
      since?: string;
      until?: string;
      mentions?: string[];
      limit?: number;
      cursor?: string;
    } = {}
  ): Promise<any> {
    return this.request('/internal/searchPosts', { query, ...options });
  }

  // Notification queries (placeholders)

  async listNotifications(
    actor: string,
    options: { limit?: number; cursor?: string; seenAt?: string } = {}
  ): Promise<any> {
    return this.request('/internal/listNotifications', { actor, ...options });
  }

  async getUnreadCount(
    actor: string,
    seenAt?: string
  ): Promise<{ count: number }> {
    return this.request<{ count: number }>('/internal/getUnreadCount', {
      actor,
      seenAt,
    });
  }

  // Feed generator queries (placeholders)

  async getFeedGenerators(uris: string[]): Promise<any> {
    return this.request('/internal/getFeedGenerators', { uris });
  }

  async getFeedGenerator(feed: string): Promise<any> {
    return this.request('/internal/getFeedGenerator', { feed });
  }

  // Health check

  async health(): Promise<{
    status: string;
    service: string;
    timestamp: string;
  }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Health check failed');
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

// Singleton instance
export const dataPlaneClient = new DataPlaneClient();
