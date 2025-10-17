import { z } from 'zod';

/**
 * Moderation Schemas
 * Used for muting, blocking, labeling, and reporting
 */

export const getMutesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const muteActorSchema = z.object({
  actor: z.string(),
});

export const getBlocksSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getListMutesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getListBlocksSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const muteActorListSchema = z.object({
  list: z.string(),
});

export const unmuteActorListSchema = z.object({
  list: z.string(),
});

export const muteThreadSchema = z.object({
  root: z.string().regex(/^at:\/\//, 'Must be a valid AT-URI'), // URI of the thread root post
});

export const queryLabelsSchema = z.object({
  uriPatterns: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? [val] : val))
    .optional(),
  sources: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? [val] : val))
    .optional(),
  limit: z.coerce.number().min(1).max(250).default(50),
  cursor: z.coerce.number().optional(),
});

export const createReportSchema = z.object({
  reasonType: z
    .string()
    .transform((val) => {
      // Strip AT Protocol prefix if present (e.g., "com.atproto.moderation.defs#reasonSpam" -> "spam")
      const match = val.match(/^com\.atproto\.moderation\.defs#reason(.+)$/);
      return match ? match[1].toLowerCase() : val;
    })
    .pipe(
      z.enum(['spam', 'violation', 'misleading', 'sexual', 'rude', 'other'])
    ),
  reason: z.string().optional(),
  subject: z.object({
    $type: z.string(),
    uri: z.string().optional(),
    did: z.string().optional(),
    cid: z.string().optional(),
  }),
});
