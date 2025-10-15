import { z } from 'zod';

/**
 * Search Schemas
 * Used for searching posts, actors, and starter packs
 */

export const searchPostsSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
