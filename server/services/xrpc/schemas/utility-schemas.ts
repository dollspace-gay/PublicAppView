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
        $type: z.string().optional(),
        subject: z.any().optional(),
        event: z.string().optional(),
        createdAt: z.string().optional(),
      })
    )
    .default([]),
});

export const unspeccedNoParamsSchema = z.object({});
