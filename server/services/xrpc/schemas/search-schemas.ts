import { z } from 'zod';

/**
 * Search Schemas
 * Used for searching posts, actors, and starter packs
 */

export const searchPostsSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
  sort: z.enum(['top', 'latest']).default('top').optional(),
  since: z.string().datetime().optional(), // ISO datetime string
  until: z.string().datetime().optional(), // ISO datetime string
  mentions: z.string().optional(), // DID of mentioned user
  author: z.string().optional(), // DID of author
  lang: z.string().optional(), // Language code (e.g., "en", "ja")
  domain: z.string().optional(), // Domain for link embed filtering
  url: z.string().url().optional(), // URL for link embed filtering
  tag: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? [val] : val))
    .optional(), // Tag(s) to filter by
});
