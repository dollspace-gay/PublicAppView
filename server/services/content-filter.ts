import type { Post, UserSettings, Label } from "@shared/schema";
import { labelService } from "./label";

export interface FilterResult {
  filtered: boolean;
  reason?: string;
  labels?: Label[];
}

export interface FilterRule {
  type: "keyword" | "user" | "custom";
  action: "hide" | "warn";
  value: string | ((post: Post) => boolean);
}

export class ContentFilterService {
  /**
   * Check labels for content (post URI or author DID) - returns only active labels
   */
  private async checkLabels(subjects: string[]): Promise<Map<string, Label[]>> {
    if (subjects.length === 0) return new Map();
    return await labelService.getActiveLabelsForSubjects(subjects);
  }

  /**
   * Determine if labels should hide content
   */
  private shouldFilterByLabels(labels: Label[]): { filter: boolean; reason?: string } {
    const hideLabels = ["spam", "nsfw", "porn", "sexual", "graphic-media", "nudity"];
    
    for (const label of labels) {
      if (hideLabels.includes(label.val)) {
        return { filter: true, reason: `Labeled as ${label.val}` };
      }
    }
    
    return { filter: false };
  }

  /**
   * Filter a single post based on user settings
   */
  filterPost(post: Post, settings: UserSettings | null): FilterResult {
    if (!settings) {
      return { filtered: false };
    }

    // Check muted users
    const mutedUsers = (settings.mutedUsers as string[]) || [];
    if (mutedUsers.includes(post.authorDid)) {
      return {
        filtered: true,
        reason: "Author is muted",
      };
    }

    // Check blocked keywords
    const blockedKeywords = (settings.blockedKeywords as string[]) || [];
    const postText = post.text.toLowerCase();
    
    for (const keyword of blockedKeywords) {
      if (postText.includes(keyword.toLowerCase())) {
        return {
          filtered: true,
          reason: `Contains blocked keyword: ${keyword}`,
        };
      }
    }

    return { filtered: false };
  }

  /**
   * Filter a single post with label checking (async version)
   */
  async filterPostWithLabels(post: Post, settings: UserSettings | null): Promise<FilterResult> {
    // First check user settings
    const basicResult = this.filterPost(post, settings);
    if (basicResult.filtered) {
      return basicResult;
    }

    // Check labels for post URI and author DID
    const labelMap = await this.checkLabels([post.uri, post.authorDid]);
    const postLabels = labelMap.get(post.uri) || [];
    const authorLabels = labelMap.get(post.authorDid) || [];
    const allLabels = [...postLabels, ...authorLabels];

    if (allLabels.length > 0) {
      const labelCheck = this.shouldFilterByLabels(allLabels);
      if (labelCheck.filter) {
        return {
          filtered: true,
          reason: labelCheck.reason,
          labels: allLabels,
        };
      }
      return {
        filtered: false,
        labels: allLabels,
      };
    }

    return { filtered: false };
  }

  /**
   * Filter an array of posts
   */
  filterPosts(posts: Post[], settings: UserSettings | null): Post[] {
    if (!settings) {
      return posts;
    }

    return posts.filter((post) => {
      const result = this.filterPost(post, settings);
      return !result.filtered;
    });
  }

  /**
   * Filter an array of posts with label checking (async version)
   */
  async filterPostsWithLabels(posts: Post[], settings: UserSettings | null): Promise<Post[]> {
    if (posts.length === 0) return posts;

    // Collect all subjects (post URIs + author DIDs)
    const subjects = new Set<string>();
    for (const post of posts) {
      subjects.add(post.uri);
      subjects.add(post.authorDid);
    }

    // Batch fetch all labels
    const labelMap = await this.checkLabels(Array.from(subjects));

    // Filter posts
    const filtered: Post[] = [];
    for (const post of posts) {
      const basicResult = this.filterPost(post, settings);
      if (basicResult.filtered) continue;

      // Check labels
      const postLabels = labelMap.get(post.uri) || [];
      const authorLabels = labelMap.get(post.authorDid) || [];
      const allLabels = [...postLabels, ...authorLabels];

      const labelCheck = this.shouldFilterByLabels(allLabels);
      if (!labelCheck.filter) {
        filtered.push(post);
      }
    }

    return filtered;
  }

  /**
   * Filter posts with custom rules
   */
  filterPostsWithRules(
    posts: Post[],
    settings: UserSettings | null,
    customRules?: FilterRule[]
  ): Post[] {
    let filtered = this.filterPosts(posts, settings);

    if (!customRules || customRules.length === 0) {
      return filtered;
    }

    // Apply custom rules
    filtered = filtered.filter((post) => {
      for (const rule of customRules) {
        if (rule.action === "hide") {
          if (rule.type === "keyword" && typeof rule.value === "string") {
            if (post.text.toLowerCase().includes(rule.value.toLowerCase())) {
              return false;
            }
          } else if (rule.type === "user" && typeof rule.value === "string") {
            if (post.authorDid === rule.value) {
              return false;
            }
          } else if (rule.type === "custom" && typeof rule.value === "function") {
            if (rule.value(post)) {
              return false;
            }
          }
        }
      }
      return true;
    });

    return filtered;
  }

  /**
   * Get filter statistics for a set of posts (async version with labels)
   */
  async getFilterStatsWithLabels(posts: Post[], settings: UserSettings | null): Promise<{
    total: number;
    filtered: number;
    byKeyword: number;
    byMutedUser: number;
    byLabel: number;
    visible: number;
  }> {
    if (!settings || posts.length === 0) {
      return {
        total: posts.length,
        filtered: 0,
        byKeyword: 0,
        byMutedUser: 0,
        byLabel: 0,
        visible: posts.length,
      };
    }

    let byKeyword = 0;
    let byMutedUser = 0;
    let byLabel = 0;

    // Batch fetch all labels
    const subjects = new Set<string>();
    for (const post of posts) {
      subjects.add(post.uri);
      subjects.add(post.authorDid);
    }
    const labelMap = await this.checkLabels(Array.from(subjects));

    let filteredCount = 0;
    for (const post of posts) {
      const result = await this.filterPostWithLabels(post, settings);
      if (result.filtered) {
        filteredCount++;
        if (result.reason?.includes("keyword")) {
          byKeyword++;
        } else if (result.reason?.includes("muted")) {
          byMutedUser++;
        } else if (result.reason?.includes("Labeled")) {
          byLabel++;
        }
      }
    }

    return {
      total: posts.length,
      filtered: filteredCount,
      byKeyword,
      byMutedUser,
      byLabel,
      visible: posts.length - filteredCount,
    };
  }

  /**
   * Get filter statistics for a set of posts
   */
  getFilterStats(posts: Post[], settings: UserSettings | null): {
    total: number;
    filtered: number;
    byKeyword: number;
    byMutedUser: number;
    visible: number;
  } {
    if (!settings) {
      return {
        total: posts.length,
        filtered: 0,
        byKeyword: 0,
        byMutedUser: 0,
        visible: posts.length,
      };
    }

    let byKeyword = 0;
    let byMutedUser = 0;

    const filtered = posts.filter((post) => {
      const result = this.filterPost(post, settings);
      if (result.filtered) {
        if (result.reason?.includes("keyword")) {
          byKeyword++;
        } else if (result.reason?.includes("muted")) {
          byMutedUser++;
        }
        return true;
      }
      return false;
    });

    return {
      total: posts.length,
      filtered: filtered.length,
      byKeyword,
      byMutedUser,
      visible: posts.length - filtered.length,
    };
  }

  /**
   * Check if a post would be filtered without actually filtering
   */
  wouldFilter(post: Post, settings: UserSettings | null): FilterResult {
    return this.filterPost(post, settings);
  }

  /**
   * Create a custom filter rule
   */
  createRule(
    type: "keyword" | "user" | "custom",
    action: "hide" | "warn",
    value: string | ((post: Post) => boolean)
  ): FilterRule {
    return { type, action, value };
  }

  /**
   * Validate and sanitize keyword
   */
  sanitizeKeyword(keyword: string): string {
    return keyword.trim().toLowerCase();
  }

  /**
   * Check if keyword is valid
   */
  isValidKeyword(keyword: string): boolean {
    const sanitized = this.sanitizeKeyword(keyword);
    return sanitized.length > 0 && sanitized.length <= 100;
  }
}

export const contentFilter = new ContentFilterService();
