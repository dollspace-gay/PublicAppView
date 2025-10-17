import { z } from 'zod';

/**
 * Utility Schemas
 * Miscellaneous schemas for various operations
 */

export const getLabelerServicesSchema = z.object({
  dids: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? [val] : val)),
  detailed: z.coerce.boolean().default(false).optional(),
});

export const getJobStatusSchema = z.object({
  jobId: z.string(),
});

export const sendInteractionsSchema = z.object({
  interactions: z
    .array(
      z.object({
        item: z
          .string()
          .regex(/^at:\/\//, 'Must be a valid AT-URI')
          .optional(),
        event: z
          .enum([
            'requestLess',
            'requestMore',
            'clickthroughItem',
            'clickthroughAuthor',
            'clickthroughReposter',
            'clickthroughEmbed',
            'interactionSeen',
            'interactionLike',
            'interactionRepost',
            'interactionReply',
            'interactionQuote',
            'interactionShare',
          ])
          .optional(),
        feedContext: z.string().max(2000).optional(),
        reqId: z.string().max(100).optional(),
      })
    )
    .min(1, 'interactions array cannot be empty'),
});

export const unspeccedNoParamsSchema = z.object({});

export const getTrendsSchema = z.object({
  limit: z.coerce.number().min(1).max(25).default(10),
});
