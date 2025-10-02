import { z } from "zod";

// Lexicon schemas for AT Protocol records
// Using lenient validation to accept real-world datetime formats
export const postSchema = z.object({
  $type: z.literal("app.bsky.feed.post"),
  text: z.string().max(3000),
  createdAt: z.string(),
  reply: z.optional(
    z.object({
      root: z.object({ uri: z.string(), cid: z.string() }),
      parent: z.object({ uri: z.string(), cid: z.string() }),
    })
  ),
  embed: z.optional(z.any()),
  langs: z.optional(z.array(z.string())),
  facets: z.optional(z.array(z.any())),
}).passthrough();

export const likeSchema = z.object({
  $type: z.literal("app.bsky.feed.like"),
  subject: z.object({
    uri: z.string(),
    cid: z.string(),
  }),
  createdAt: z.string(),
}).passthrough();

export const repostSchema = z.object({
  $type: z.literal("app.bsky.feed.repost"),
  subject: z.object({
    uri: z.string(),
    cid: z.string(),
  }),
  createdAt: z.string(),
}).passthrough();

export const profileSchema = z.object({
  $type: z.literal("app.bsky.actor.profile"),
  displayName: z.optional(z.string().max(640)),
  description: z.optional(z.string().max(2560)),
  avatar: z.optional(z.any()),
  banner: z.optional(z.any()),
}).passthrough();

export const followSchema = z.object({
  $type: z.literal("app.bsky.graph.follow"),
  subject: z.string(),
  createdAt: z.string(),
}).passthrough();

export const blockSchema = z.object({
  $type: z.literal("app.bsky.graph.block"),
  subject: z.string(),
  createdAt: z.string(),
}).passthrough();

export class LexiconValidator {
  private validCount = 0;
  private invalidCount = 0;
  private unknownCount = 0;
  private errorLog: Array<{ type: string; error: string; timestamp: Date }> = [];

  validate(type: string, record: any): boolean {
    try {
      switch (type) {
        case "app.bsky.feed.post":
          postSchema.parse(record);
          this.validCount++;
          break;
        case "app.bsky.feed.like":
          likeSchema.parse(record);
          this.validCount++;
          break;
        case "app.bsky.feed.repost":
          repostSchema.parse(record);
          this.validCount++;
          break;
        case "app.bsky.actor.profile":
          profileSchema.parse(record);
          this.validCount++;
          break;
        case "app.bsky.graph.follow":
          followSchema.parse(record);
          this.validCount++;
          break;
        case "app.bsky.graph.block":
          blockSchema.parse(record);
          this.validCount++;
          break;
        default:
          // Pass through unknown record types (threadgate, postgate, listitem, etc.)
          this.unknownCount++;
          return true;
      }
      return true;
    } catch (error) {
      this.invalidCount++;
      this.errorLog.push({
        type,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      });
      if (this.errorLog.length > 1000) {
        this.errorLog.shift();
      }
      return false;
    }
  }

  getStats() {
    const total = this.validCount + this.invalidCount + this.unknownCount;
    return {
      total,
      valid: this.validCount,
      invalid: this.invalidCount,
      unknown: this.unknownCount,
      errorRate: total > 0 ? (this.invalidCount / total) * 100 : 0,
      recentErrors: this.errorLog.slice(-10),
    };
  }

  resetStats() {
    this.validCount = 0;
    this.invalidCount = 0;
    this.unknownCount = 0;
    this.errorLog = [];
  }
}

export const lexiconValidator = new LexiconValidator();
