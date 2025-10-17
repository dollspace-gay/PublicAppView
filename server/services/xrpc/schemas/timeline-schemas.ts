import { z } from 'zod';

/**
 * Timeline and Post Thread Schemas
 * Used for timeline feeds and post thread queries
 */

export const getTimelineSchema = z.object({
  algorithm: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getAuthorFeedSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  filter: z
    .enum([
      'posts_with_replies',
      'posts_no_replies',
      'posts_with_media',
      'posts_and_author_threads',
      'posts_with_video',
    ])
    .default('posts_with_replies'),
  includePins: z.coerce.boolean().default(false),
});

export const getPostThreadSchema = z.object({
  uri: z.string(),
  depth: z.coerce.number().min(0).max(10).default(6),
});

export const getPostsSchema = z.object({
  uris: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .pipe(
      z
        .array(z.string().regex(/^at:\/\//, 'Must be a valid AT-URI'))
        .min(1, 'uris parameter cannot be empty')
        .max(25, 'Maximum 25 uris allowed')
    ),
});

export const getLikesSchema = z.object({
  uri: z.string().regex(/^at:\/\//, 'Must be a valid AT-URI'),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getRepostedBySchema = z.object({
  uri: z.string().regex(/^at:\/\//, 'Must be a valid AT-URI'),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getQuotesSchema = z.object({
  uri: z.string().regex(/^at:\/\//, 'Must be a valid AT-URI'),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getActorLikesSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// V2 Thread schemas (unspecced but compatible)
export const getPostThreadV2Schema = z.object({
  anchor: z.string().regex(/^at:\/\//, 'Must be a valid AT-URI'),
  above: z.coerce.boolean().default(true),
  below: z.coerce.number().min(0).max(20).default(6),
  branchingFactor: z.coerce.number().min(0).max(100).default(10),
  prioritizeFollowedUsers: z.coerce.boolean().default(false),
  sort: z.enum(['newest', 'oldest', 'top']).default('oldest'),
});

export const getPostThreadOtherV2Schema = z.object({
  anchor: z.string().regex(/^at:\/\//, 'Must be a valid AT-URI'),
  prioritizeFollowedUsers: z.coerce.boolean().default(false),
});
