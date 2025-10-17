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

export const getUnreadCountSchema = z.object({
  seenAt: z.string().datetime().optional(), // ISO datetime - only count notifications after this time
});

export const updateSeenSchema = z.object({
  seenAt: z.string().datetime(), // ISO datetime when user last viewed notifications
});

export const registerPushSchema = z.object({
  serviceDid: z.string(), // The DID of the service (AppView) handling push
  token: z.string(), // Device token (FCM/APNs) or subscription endpoint (web)
  platform: z.enum(['ios', 'android', 'web']),
  appId: z.string().optional(),
  // Web push specific fields
  endpoint: z.string().url().optional(), // Web push subscription endpoint
  keys: z
    .object({
      p256dh: z.string(),
      auth: z.string(),
    })
    .optional(), // Web push encryption keys
});

export const unregisterPushSchema = z.object({
  serviceDid: z.string(), // The DID of the service (AppView) handling push
  token: z.string(), // Device token to unregister
  platform: z.enum(['ios', 'android', 'web']),
  appId: z.string(), // Application identifier
});

export const getNotificationPreferencesSchema = z.object({});

export const putNotificationPreferencesSchema = z.object({
  priority: z.boolean().optional(),
});

// ATProto notification preference types
const preferenceSchema = z.object({
  list: z.boolean(),
  push: z.boolean(),
});

const filterablePreferenceSchema = z.object({
  list: z.boolean(),
  push: z.boolean(),
  include: z.enum(['all', 'follows']),
});

const chatPreferenceSchema = z.object({
  include: z.enum(['all', 'accepted']),
  push: z.boolean(),
});

export const putNotificationPreferencesV2Schema = z.object({
  chat: chatPreferenceSchema.optional(),
  follow: filterablePreferenceSchema.optional(),
  like: filterablePreferenceSchema.optional(),
  mention: filterablePreferenceSchema.optional(),
  reply: filterablePreferenceSchema.optional(),
  repost: filterablePreferenceSchema.optional(),
  quote: filterablePreferenceSchema.optional(),
  likeViaRepost: filterablePreferenceSchema.optional(),
  repostViaRepost: filterablePreferenceSchema.optional(),
  starterpackJoined: preferenceSchema.optional(),
  subscribedPost: preferenceSchema.optional(),
  unverified: preferenceSchema.optional(),
  verified: preferenceSchema.optional(),
});

export const getNotificationPreferencesV2Schema = z.object({});

export const listActivitySubscriptionsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const putActivitySubscriptionSchema = z.object({
  subject: z.string(), // DID of the account to subscribe to
  activitySubscription: z.object({
    post: z.boolean(), // Notify on posts
    reply: z.boolean(), // Notify on replies
  }),
});
