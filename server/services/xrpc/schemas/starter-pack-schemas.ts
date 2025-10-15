import { z } from 'zod';

/**
 * Starter Pack Schemas
 * Used for starter pack discovery and queries
 */

export const getStarterPackSchema = z.object({
  starterPack: z.string(),
});

export const getStarterPacksSchema = z.object({
  uris: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (typeof val === 'string' ? [val] : val)),
});

export const getActorStarterPacksSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const getStarterPacksWithMembershipSchema = z.object({
  actor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const searchStarterPacksSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
