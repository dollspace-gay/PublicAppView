import type { Post } from "@shared/schema";
import { storage } from "../storage";

export interface PostWithEngagement extends Post {
  likeCount?: number;
  repostCount?: number;
  engagementScore?: number;
}

export type FeedAlgorithm = "reverse-chronological" | "engagement" | "discovery";

export class FeedAlgorithmService {
  async enrichPostsWithEngagement(posts: Post[]): Promise<PostWithEngagement[]> {
    if (posts.length === 0) {
      return [];
    }

    const postUris = posts.map(p => p.uri);
    
    const [allLikes, allReposts] = await Promise.all([
      Promise.all(postUris.map(uri => storage.getPostLikes(uri))),
      Promise.all(postUris.map(uri => storage.getPostReposts(uri))),
    ]);
    
    const likeCounts = new Map(postUris.map((uri, i) => [uri, allLikes[i].length]));
    const repostCounts = new Map(postUris.map((uri, i) => [uri, allReposts[i].length]));
    
    const enrichedPosts = posts.map((post) => {
      const likeCount = likeCounts.get(post.uri) || 0;
      const repostCount = repostCounts.get(post.uri) || 0;
      
      const hoursSinceIndexed = (Date.now() - post.indexedAt.getTime()) / (1000 * 60 * 60);
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
    algorithm: FeedAlgorithm = "reverse-chronological"
  ): Promise<PostWithEngagement[]> {
    switch (algorithm) {
      case "reverse-chronological":
        return this.reverseChronological(posts);
      
      case "engagement":
        return this.engagementBased(posts);
      
      case "discovery":
        return this.discoveryBased(posts);
      
      default:
        return this.reverseChronological(posts);
    }
  }

  private async reverseChronological(posts: Post[]): Promise<PostWithEngagement[]> {
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
    
    const recentPosts = enriched.filter(post => {
      const hoursSinceIndexed = (Date.now() - post.indexedAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceIndexed <= 24;
    });
    
    const diverseAuthors = new Set<string>();
    const discoveryFeed: PostWithEngagement[] = [];
    
    recentPosts.sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0));
    
    for (const post of recentPosts) {
      if (discoveryFeed.length >= posts.length) break;
      
      if (!diverseAuthors.has(post.authorDid) || diverseAuthors.size >= 10) {
        discoveryFeed.push(post);
        diverseAuthors.add(post.authorDid);
      }
    }
    
    const olderPosts = enriched.filter(post => {
      const hoursSinceIndexed = (Date.now() - post.indexedAt.getTime()) / (1000 * 60 * 60);
      return hoursSinceIndexed > 24 && !discoveryFeed.includes(post);
    });
    
    olderPosts.sort((a, b) => b.indexedAt.getTime() - a.indexedAt.getTime());
    
    return [...discoveryFeed, ...olderPosts];
  }

  parseAlgorithm(algorithmParam?: string): FeedAlgorithm {
    if (!algorithmParam) return "reverse-chronological";
    
    const normalized = algorithmParam.toLowerCase();
    if (normalized === "engagement" || normalized === "top" || normalized === "hot") {
      return "engagement";
    }
    if (normalized === "discovery" || normalized === "explore") {
      return "discovery";
    }
    
    return "reverse-chronological";
  }
}

export const feedAlgorithm = new FeedAlgorithmService();
