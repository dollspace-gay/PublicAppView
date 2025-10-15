import { z } from 'zod';

/**
 * Social Graph Schemas
 * Used for relationships, followers, and social connections
 */

export const getRelationshipsSchema = z.object({
  actor: z.string(),
  others: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? [val] : val))
    .optional(),
});

export const getKnownFollowersSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
