import { z } from "zod";
import { didResolver } from "./did-resolver";
import { storage } from "../storage";
import type { Post } from "@shared/schema";

const skeletonPostSchema = z.object({
  post: z.string(),
  reason: z.any().optional(),
});

const feedSkeletonResponseSchema = z.object({
  feed: z.array(skeletonPostSchema),
  cursor: z.string().optional(),
});

export interface FeedGeneratorParams {
  feed: string;
  limit: number;
  cursor?: string;
  feedGeneratorDid?: string;
}

export interface HydratedFeedPost {
  post: Post;
  reason?: any;
}

export class FeedGeneratorClient {
  private readonly timeout = 10000; // 10 seconds
  private cache: Map<string, { endpoint: string; timestamp: number }> = new Map();
  private readonly cacheTTL = 3600000; // 1 hour

  async getFeedSkeleton(
    serviceEndpoint: string,
    params: FeedGeneratorParams,
    options?: { viewerAuthorization?: string | undefined }
  ): Promise<{ feed: Array<{ post: string; reason?: any }>; cursor?: string }> {
    try {
      const url = new URL("/xrpc/app.bsky.feed.getFeedSkeleton", serviceEndpoint);
      url.searchParams.set("feed", params.feed);
      url.searchParams.set("limit", params.limit.toString());
      if (params.cursor) {
        url.searchParams.set("cursor", params.cursor);
      }

      console.log(`[FeedGenClient] Fetching skeleton from ${url.toString()}`);

      const headers: Record<string, string> = {
        "Accept": "application/json",
      };

      // Forward viewer Authorization to feed generator when present, aligning with upstream behavior
      if (options?.viewerAuthorization) {
        headers["Authorization"] = options.viewerAuthorization;
        console.log(`[FeedGenClient] Forwarded viewer Authorization header to feedgen`);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        console.error(
          `[FeedGenClient] Feed generator returned ${response.status}: ${await response.text()}`
        );
        throw new Error(`Feed generator returned ${response.status}`);
      }

      const data = await response.json();
      const skeleton = feedSkeletonResponseSchema.parse(data);

      console.log(`[FeedGenClient] Received ${skeleton.feed.length} posts from feed generator`);

      return skeleton;
    } catch (error) {
      console.error("[FeedGenClient] Error fetching skeleton:", error);
      throw error;
    }
  }

  async hydrateSkeleton(
    skeleton: Array<{ post: string; reason?: any }>
  ): Promise<HydratedFeedPost[]> {
    if (skeleton.length === 0) {
      return [];
    }

    const postUris = skeleton.map(item => item.post);
    console.log(`[FeedGenClient] Hydrating ${postUris.length} posts`);

    const posts = await storage.getPosts(postUris);

    const postMap = new Map(posts.map(p => [p.uri, p]));

    const hydrated: HydratedFeedPost[] = [];
    for (const item of skeleton) {
      const post = postMap.get(item.post);
      if (post) {
        hydrated.push({
          post,
          reason: item.reason,
        });
      } else {
        console.warn(`[FeedGenClient] Post not found in database: ${item.post}`);
      }
    }

    console.log(`[FeedGenClient] Successfully hydrated ${hydrated.length}/${postUris.length} posts`);

    return hydrated;
  }

  async resolveFeedGeneratorEndpoint(serviceDid: string): Promise<string | null> {
    const cached = this.cache.get(serviceDid);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.endpoint;
    }

    const endpoint = await didResolver.resolveDIDToFeedGenerator(serviceDid);
    
    if (endpoint) {
      this.cache.set(serviceDid, { endpoint, timestamp: Date.now() });
    }

    return endpoint;
  }

  async getFeed(
    serviceDid: string,
    params: FeedGeneratorParams,
    options?: { viewerAuthorization?: string | undefined }
  ): Promise<{ feed: HydratedFeedPost[]; cursor?: string }> {
    const endpoint = await this.resolveFeedGeneratorEndpoint(serviceDid);
    
    if (!endpoint) {
      throw new Error(`Could not resolve feed generator endpoint for ${serviceDid}`);
    }

    const paramsWithDid = {
      ...params,
      feedGeneratorDid: serviceDid,
    };

    const skeleton = await this.getFeedSkeleton(endpoint, paramsWithDid, {
      viewerAuthorization: options?.viewerAuthorization,
    });

    const hydrated = await this.hydrateSkeleton(skeleton.feed);

    return {
      feed: hydrated,
      cursor: skeleton.cursor,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}

export const feedGeneratorClient = new FeedGeneratorClient();
