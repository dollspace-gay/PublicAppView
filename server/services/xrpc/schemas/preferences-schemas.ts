import { z } from 'zod';

/**
 * Preferences Schemas
 * Used for user preferences and settings
 */

export const putActorPreferencesSchema = z.object({
  preferences: z
    .array(
      z
        .object({
          $type: z.string().min(1, 'Preference must have a $type'),
          // Allow any additional properties for flexibility
        })
        .passthrough()
    )
    .default([]),
});
