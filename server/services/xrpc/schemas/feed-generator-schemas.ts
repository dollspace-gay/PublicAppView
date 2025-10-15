import { z } from 'zod';

/**
 * Feed Generator Schemas
 * Used for custom feed generators and feed discovery
 */

export const getFeedSchema = z.object({
  feed: z.string(), // AT URI of feed generator
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getFeedGeneratorSchema = z.object({
  feed: z.string(),
});

export const getFeedGeneratorsSchema = z.object({
  feeds: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? [val] : val)),
});

export const getActorFeedsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getSuggestedFeedsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getPopularFeedGeneratorsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  query: z.string().optional(),
});

export const describeFeedGeneratorSchema = z.object({
  // No required params
});
