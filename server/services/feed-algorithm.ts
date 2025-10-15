import type { Post } from '@shared/schema';
import { db } from '../db';
import { postAggregations } from '@shared/schema';
import { inArray } from 'drizzle-orm';
import { cacheService } from './cache';

export interface PostWithEngagement extends Post {
  likeCount?: number;
  repostCount?: number;
  engagementScore?: number;
}

export type FeedAlgorithm =
  | 'reverse-chronological'
  | 'engagement'
  | 'discovery';

export class FeedAlgorithmService {
  async enrichPostsWithEngagement(
    posts: Post[]
  ): Promise<PostWithEngagement[]> {
    if (posts.length === 0) {
      return [];
    }

    const postUris = posts.map((p) => p.uri);

    // Try to get aggregations from Redis cache first
    let aggregationsMap = await cacheService.getPostAggregations(postUris);

    if (!aggregationsMap) {
      // Cache miss - fetch from database in a SINGLE batch query
      const aggregations = await db
        .select()
        .from(postAggregations)
        .where(inArray(postAggregations.postUri, postUris));

      aggregationsMap = new Map(aggregations.map((agg) => [agg.postUri, agg]));

      // Cache the results for future requests
      await cacheService.setPostAggregations(aggregationsMap);

      console.log(
        `[FEED_ALGORITHM] Fetched aggregations for ${postUris.length} posts from DB (${aggregations.length} found)`
      );
    } else {
      console.log(`[FEED_ALGORITHM] Cache hit for ${postUris.length} posts`);
    }

    const enrichedPosts = posts.map((post) => {
      const agg = aggregationsMap.get(post.uri);
      const likeCount = agg?.likeCount || 0;
      const repostCount = agg?.repostCount || 0;

      const hoursSinceIndexed =
        (Date.now() - post.indexedAt.getTime()) / (1000 * 60 * 60);
      const timeDecay = 1 / (1 + hoursSinceIndexed / 24);
      const engagementScore = (likeCount + repostCount * 2) * timeDecay;

      return {
        ...post,
        likeCount,
        repostCount,
        engagementScore,
      };
    });

    return enrichedPosts;
  }

  async applyAlgorithm(
    posts: Post[],
    algorithm: FeedAlgorithm = 'reverse-chronological'
  ): Promise<PostWithEngagement[]> {
    switch (algorithm) {
      case 'reverse-chronological':
        return this.reverseChronological(posts);

      case 'engagement':
        return this.engagementBased(posts);

      case 'discovery':
        return this.discoveryBased(posts);

      default:
        return this.reverseChronological(posts);
    }
  }

  private async reverseChronological(
    posts: Post[]
  ): Promise<PostWithEngagement[]> {
    const enriched = await this.enrichPostsWithEngagement(posts);

    enriched.sort((a, b) => b.indexedAt.getTime() - a.indexedAt.getTime());

    return enriched;
  }

  private async engagementBased(posts: Post[]): Promise<PostWithEngagement[]> {
    const enriched = await this.enrichPostsWithEngagement(posts);

    enriched.sort((a, b) => {
      const scoreA = a.engagementScore || 0;
      const scoreB = b.engagementScore || 0;

      if (Math.abs(scoreA - scoreB) < 0.001) {
        return b.indexedAt.getTime() - a.indexedAt.getTime();
      }

      return scoreB - scoreA;
    });

    return enriched;
  }

  private async discoveryBased(posts: Post[]): Promise<PostWithEngagement[]> {
    const enriched = await this.enrichPostsWithEngagement(posts);

    const recentPosts = enriched.filter((post) => {
      const hoursSinceIndexed =
        (Date.now() - post.indexedAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceIndexed <= 24;
    });

    const diverseAuthors = new Set<string>();
    const discoveryFeed: PostWithEngagement[] = [];

    recentPosts.sort(
      (a, b) => (b.engagementScore || 0) - (a.engagementScore || 0)
    );

    for (const post of recentPosts) {
      if (discoveryFeed.length >= posts.length) break;

      if (!diverseAuthors.has(post.authorDid) || diverseAuthors.size >= 10) {
        discoveryFeed.push(post);
        diverseAuthors.add(post.authorDid);
      }
    }

    const olderPosts = enriched.filter((post) => {
      const hoursSinceIndexed =
        (Date.now() - post.indexedAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceIndexed > 24 && !discoveryFeed.includes(post);
    });

    olderPosts.sort((a, b) => b.indexedAt.getTime() - a.indexedAt.getTime());

    return [...discoveryFeed, ...olderPosts];
  }

  parseAlgorithm(algorithmParam?: string): FeedAlgorithm {
    if (!algorithmParam) return 'reverse-chronological';

    const normalized = algorithmParam.toLowerCase();
    if (
      normalized === 'engagement' ||
      normalized === 'top' ||
      normalized === 'hot'
    ) {
      return 'engagement';
    }
    if (normalized === 'discovery' || normalized === 'explore') {
      return 'discovery';
    }

    return 'reverse-chronological';
  }
}

export const feedAlgorithm = new FeedAlgorithmService();
