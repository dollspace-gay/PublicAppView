import { z } from 'zod';

/**
 * Actor/Profile Schemas
 * Used for profile queries, follows, and actor-related operations
 */

export const getProfileSchema = z.object({
  actor: z.string(),
});

export const getProfilesSchema = z.object({
  actors: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .pipe(
      z
        .array(z.string())
        .min(1, 'actors parameter cannot be empty')
        .max(25, 'Maximum 25 actors allowed')
    ),
});

export const getFollowsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getSuggestionsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getSuggestedFollowsByActorSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(25),
});

export const searchActorsSchema = z
  .object({
    q: z.string().optional(),
    term: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(25),
    cursor: z.string().optional(),
  })
  .refine((data) => data.q || data.term, {
    message: "Either 'q' or 'term' parameter is required",
  });

export const searchActorsTypeaheadSchema = z
  .object({
    q: z.string().optional(),
    term: z.string().optional(),
    limit: z.coerce.number().min(1).max(10).default(10),
  })
  .refine((data) => data.q || data.term, {
    message: "Either 'q' or 'term' parameter is required",
  });

export const suggestedUsersUnspeccedSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
