import { z } from 'zod';

/**
 * Notification Schemas
 * Used for push notifications and notification preferences
 */

export const listNotificationsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  seenAt: z.string().optional(),
});

export const updateSeenSchema = z.object({
  seenAt: z.string(),
});

export const registerPushSchema = z.object({
  serviceDid: z.string(),
  token: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  appId: z.string().optional(),
});

export const unregisterPushSchema = z.object({
  token: z.string(),
});

export const getNotificationPreferencesSchema = z.object({});

export const putNotificationPreferencesSchema = z.object({
  priority: z.boolean().optional(),
});

export const putNotificationPreferencesV2Schema = z.object({
  priority: z.boolean().optional(),
});

export const listActivitySubscriptionsSchema = z.object({});

export const putActivitySubscriptionSchema = z.object({
  subject: z.string().optional(),
  notifications: z.boolean().optional(),
});
