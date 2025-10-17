/**
 * Notification Service
 * Handles notifications, notification preferences, and activity subscriptions
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { transformBlobToCdnUrl } from '../utils/serializers';
import {
  listNotificationsSchema,
  getUnreadCountSchema,
  updateSeenSchema,
  getNotificationPreferencesSchema,
  putNotificationPreferencesSchema,
  putNotificationPreferencesV2Schema,
  listActivitySubscriptionsSchema,
  putActivitySubscriptionSchema,
} from '../schemas';

/**
 * Helper to optionally add avatar to object
 */
function maybeAvatar(
  avatarCid: string | null | undefined,
  did: string,
  req?: Request
): { avatar: string } | Record<string, never> {
  if (!avatarCid) return {};
  const url = transformBlobToCdnUrl(avatarCid, did, 'avatar', req);
  // Ensure the URL is a valid non-empty string before including it
  return url && typeof url === 'string' && url.trim() !== ''
    ? { avatar: url }
    : {};
}

/**
 * List user notifications
 * GET /xrpc/app.bsky.notification.listNotifications
 */
export async function listNotifications(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = listNotificationsSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    console.log(`[listNotifications] Fetching notifications for ${userDid}`);
    const notificationsList = await storage.getNotifications(
      userDid,
      params.limit,
      params.cursor,
      params.seenAt ? new Date(params.seenAt) : undefined
    );
    console.log(
      `[listNotifications] Found ${notificationsList.length} notifications`
    );

    // Collect all reasonSubject URIs (posts being interacted with)
    const postUris = notificationsList
      .map((n) => (n as { reasonSubject?: string }).reasonSubject)
      .filter((uri): uri is string => !!uri);

    // Batch fetch all posts at once (not one by one)
    const postsMap = new Map<string, any>();
    if (postUris.length > 0) {
      const existingPosts = await storage.getPosts(postUris);
      existingPosts.forEach((post) => postsMap.set(post.uri, post));

      const missingUris = postUris.filter((uri) => !postsMap.has(uri));
      if (missingUris.length > 0) {
        console.log(
          `[listNotifications] ${missingUris.length} notification posts not in database (will be backfilled on login)`
        );
      }
    }

    const authorDids = Array.from(
      new Set(
        notificationsList.map((n) => (n as { authorDid: string }).authorDid)
      )
    );

    // Author profiles should be available from firehose events
    const authors = await storage.getUsers(authorDids);
    const authorMap = new Map(authors.map((a) => [a.did, a]));

    // Get viewer relationships with all authors
    const relationships = await storage.getRelationships(userDid, authorDids);

    const items = await Promise.all(
      notificationsList.map(async (n) => {
        const notification = n as {
          authorDid: string;
          reasonSubject?: string;
          reason: string;
          uri: string;
          cid?: string;
          indexedAt: Date;
          isRead: boolean;
        };

        const author = authorMap.get(notification.authorDid);

        // Skip notifications from authors without valid handles
        if (!author || !(author as { handle?: string }).handle) {
          console.warn(
            `[XRPC] Skipping notification from ${notification.authorDid} - no valid handle`
          );
          return null;
        }

        // Validate that the notification subject still exists
        let reasonSubject = notification.reasonSubject;
        let record:
          | {
              $type: string;
              text?: string;
              createdAt?: string;
              embed?: unknown;
              facets?: unknown;
            }
          | { $type: string } = {
          $type: 'app.bsky.notification.defs#recordDeleted',
        };

        if (reasonSubject) {
          // For post-related notifications, check if the post still exists
          if (
            notification.reason === 'like' ||
            notification.reason === 'repost' ||
            notification.reason === 'reply' ||
            notification.reason === 'quote'
          ) {
            const post = postsMap.get(reasonSubject);
            if (!post) {
              // Post was deleted or not found, filter out this notification
              return null;
            }
            const postData = post as {
              text: string;
              createdAt: Date;
              embed?: unknown;
              facets?: unknown;
            };
            record = {
              $type: 'app.bsky.feed.post',
              text: postData.text,
              createdAt: postData.createdAt.toISOString(),
            };
            if (postData.embed)
              (record as { embed?: unknown }).embed = postData.embed;
            if (postData.facets)
              (record as { facets?: unknown }).facets = postData.facets;
          }
        } else {
          // For notifications without a reasonSubject (like follows), create a fallback
          reasonSubject = `at://${notification.authorDid}/app.bsky.graph.follow/${notification.indexedAt.getTime()}`;
        }

        // Create proper AT URI based on notification reason
        let notificationUri = reasonSubject;
        if (!notificationUri) {
          // For follow notifications, create a follow record URI
          if (notification.reason === 'follow') {
            notificationUri = `at://${notification.authorDid}/app.bsky.graph.follow/${notification.indexedAt.getTime()}`;
          } else {
            // Fallback for other cases
            notificationUri = `at://${notification.authorDid}/app.bsky.feed.post/unknown`;
          }
        }

        // Use the actual CID from the database if available, otherwise generate a placeholder
        const notificationCid =
          notification.cid ||
          `bafkrei${Buffer.from(`${notification.uri}-${notification.indexedAt.getTime()}`).toString('base64url').slice(0, 44)}`;

        const authorData = author as {
          did: string;
          handle: string;
          displayName?: string;
          pronouns?: string;
          avatarUrl?: string;
          createdAt?: Date;
        };

        // Get actual viewer state for this author
        const viewerState = relationships.get(authorData.did);
        const viewer: {
          muted: boolean;
          blockedBy: boolean;
          blocking?: string;
          following?: string;
          followedBy?: string;
        } = {
          muted: viewerState ? !!viewerState.muting : false,
          blockedBy: viewerState?.blockedBy || false,
        };
        if (viewerState?.blocking) viewer.blocking = viewerState.blocking;
        if (viewerState?.following) viewer.following = viewerState.following;
        if (viewerState?.followedBy) viewer.followedBy = viewerState.followedBy;

        const view = {
          $type: 'app.bsky.notification.listNotifications#notification',
          uri: notificationUri,
          cid: notificationCid,
          isRead: notification.isRead,
          indexedAt: notification.indexedAt.toISOString(),
          reason: notification.reason,
          reasonSubject: reasonSubject, // Always a string now
          record: record || {
            $type: 'app.bsky.notification.defs#recordDeleted',
          },
          author: {
            $type: 'app.bsky.actor.defs#profileViewBasic',
            did: authorData.did,
            handle: authorData.handle,
            displayName: authorData.displayName ?? authorData.handle,
            pronouns: authorData.pronouns,
            ...maybeAvatar(authorData.avatarUrl, authorData.did, req),
            viewer,
          },
        };
        return view;
      })
    );

    // Filter out null items (deleted content)
    const validItems = items.filter((item) => item !== null);
    console.log(
      `[listNotifications] Returning ${validItems.length} valid notifications (filtered ${items.length - validItems.length} deleted/invalid)`
    );

    const cursor = notificationsList.length
      ? (
          notificationsList[notificationsList.length - 1] as {
            indexedAt: Date;
          }
        ).indexedAt.toISOString()
      : undefined;

    res.json({ notifications: validItems, cursor });
  } catch (error) {
    console.error('[listNotifications] Error details:', error);
    console.error(
      '[listNotifications] Error stack:',
      error instanceof Error ? error.stack : 'No stack trace'
    );
    handleError(res, error, 'listNotifications');
  }
}

/**
 * Get unread notification count
 * GET /xrpc/app.bsky.notification.getUnreadCount
 */
export async function getUnreadCount(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getUnreadCountSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // If seenAt is provided, count only notifications after that time
    let count: number;
    if (params.seenAt) {
      const seenAtDate = new Date(params.seenAt);
      const allNotifications = await storage.getNotifications(
        userDid,
        1000, // High limit to get all recent
        undefined,
        undefined // No seenAt filter here
      );
      // Count unread notifications that occurred after seenAt
      count = allNotifications.filter(
        (n) => !n.isRead && n.indexedAt > seenAtDate
      ).length;
    } else {
      // No seenAt filter - just count all unread
      count = await storage.getUnreadNotificationCount(userDid);
    }

    // Get user's last seenAt from preferences
    const prefs = await storage.getUserPreferences(userDid);
    const lastSeenAt = (prefs as { lastNotificationSeenAt?: Date })
      ?.lastNotificationSeenAt;

    res.json({
      count,
      ...(lastSeenAt && { seenAt: lastSeenAt.toISOString() }),
    });
  } catch (error) {
    handleError(res, error, 'getUnreadCount');
  }
}

/**
 * Mark notifications as seen
 * POST /xrpc/app.bsky.notification.updateSeen
 */
export async function updateSeen(req: Request, res: Response): Promise<void> {
  try {
    const params = updateSeenSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const seenAtDate = new Date(params.seenAt);

    // Mark notifications as read up to the seenAt timestamp
    await storage.markNotificationsAsRead(userDid, seenAtDate);

    // Update user's lastNotificationSeenAt preference for cross-device sync
    const prefs = await storage.getUserPreferences(userDid);
    if (prefs) {
      await storage.updateUserPreferences(userDid, {
        lastNotificationSeenAt: seenAtDate,
      } as any);
    } else {
      // Create preferences if they don't exist
      await storage.createUserPreferences({
        userDid,
        lastNotificationSeenAt: seenAtDate,
      } as any);
    }

    // AT Protocol spec: return empty object on success
    res.json({});
  } catch (error) {
    handleError(res, error, 'updateSeen');
  }
}

/**
 * Get notification preferences
 * GET /xrpc/app.bsky.notification.getPreferences
 *
 * NOTE: Unlike app.bsky.actor.getPreferences (which retrieves general account preferences
 * from the PDS), notification preferences are stored on the AppView because they control
 * how THIS AppView delivers notifications to the user.
 *
 * Architectural rationale:
 * - Notification preferences are service-level settings specific to each AppView instance
 * - These settings control how the AppView processes and filters notifications
 * - The AppView needs direct access to these preferences to deliver notifications
 * - These are NOT portable user preferences that should travel between services
 *
 * Per ATProto architecture, this pattern is acknowledged as "not ideal" but is the
 * current design for notification delivery services. The app.bsky.notification.*
 * namespace is intentionally distinct from app.bsky.actor.* to reflect this difference.
 */
export async function getNotificationPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    getNotificationPreferencesSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;
    const prefs = await storage.getUserPreferences(userDid);
    res.json({
      preferences: [
        {
          $type: 'app.bsky.notification.defs#preferences',
          priority: !!(prefs as { notificationPriority?: boolean })
            ?.notificationPriority,
        },
      ],
    });
  } catch (error) {
    handleError(res, error, 'getNotificationPreferences');
  }
}

/**
 * Update notification preferences
 * POST /xrpc/app.bsky.notification.putPreferences
 *
 * NOTE: Unlike app.bsky.actor.putPreferences (which stores general account preferences
 * on the PDS), notification preferences are stored on the AppView because they control
 * how THIS AppView delivers notifications to the user.
 *
 * Architectural rationale:
 * - Notification preferences are service-level settings specific to each AppView instance
 * - These settings control how the AppView processes and filters notifications
 * - The AppView needs direct access to these preferences to deliver notifications
 * - These are NOT portable user preferences that should travel between services
 *
 * Per ATProto architecture, this pattern is acknowledged as "not ideal" but is the
 * current design for notification delivery services. The app.bsky.notification.*
 * namespace is intentionally distinct from app.bsky.actor.* to reflect this difference.
 */
export async function putNotificationPreferences(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = putNotificationPreferencesSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get existing preferences or create new ones if they don't exist
    let prefs = await storage.getUserPreferences(userDid);
    if (!prefs) {
      prefs = await storage.createUserPreferences({
        userDid,
        notificationPriority:
          params.priority !== undefined ? params.priority : false,
      } as {
        userDid: string;
        notificationPriority: boolean;
      });
    } else {
      // Update notification preferences
      prefs = await storage.updateUserPreferences(userDid, {
        notificationPriority:
          params.priority !== undefined
            ? params.priority
            : (prefs as { notificationPriority: boolean }).notificationPriority,
      });
    }

    res.json({
      priority:
        (prefs as { notificationPriority?: boolean })?.notificationPriority ??
        false,
    });
  } catch (error) {
    handleError(res, error, 'putNotificationPreferences');
  }
}

/**
 * Update notification preferences (V2)
 * POST /xrpc/app.bsky.notification.putPreferencesV2
 *
 * ATProto-compliant notification preferences supporting all 13 notification categories
 *
 * NOTE: Unlike app.bsky.actor.putPreferences (which stores general account preferences
 * on the PDS), notification preferences are stored on the AppView because they control
 * how THIS AppView delivers notifications to the user.
 *
 * Architectural rationale:
 * - Notification preferences are service-level settings specific to each AppView instance
 * - These settings control how the AppView processes and filters notifications
 * - The AppView needs direct access to these preferences to deliver notifications
 * - These are NOT portable user preferences that should travel between services
 *
 * Per ATProto architecture, this pattern is acknowledged as "not ideal" but is the
 * current design for notification delivery services. The app.bsky.notification.*
 * namespace is intentionally distinct from app.bsky.actor.* to reflect this difference.
 */
export async function putNotificationPreferencesV2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = putNotificationPreferencesV2Schema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get existing preferences or create with defaults
    let userPrefs = await storage.getUserPreferences(userDid);
    if (!userPrefs) {
      userPrefs = await storage.createUserPreferences({
        userDid,
      } as any);
    }

    // Get current notification preferences V2 (or use defaults)
    const currentPrefs = (userPrefs as any).notificationPreferencesV2 || {
      chat: { include: 'accepted', push: true },
      follow: { list: true, push: true, include: 'all' },
      like: { list: true, push: false, include: 'follows' },
      mention: { list: true, push: true, include: 'all' },
      reply: { list: true, push: true, include: 'all' },
      repost: { list: true, push: false, include: 'follows' },
      quote: { list: true, push: true, include: 'all' },
      likeViaRepost: { list: false, push: false, include: 'all' },
      repostViaRepost: { list: false, push: false, include: 'all' },
      starterpackJoined: { list: true, push: false },
      subscribedPost: { list: true, push: true },
      unverified: { list: true, push: false },
      verified: { list: true, push: true },
    };

    // Merge new preferences with existing (partial update)
    const updatedPrefs = {
      chat: params.chat ?? currentPrefs.chat,
      follow: params.follow ?? currentPrefs.follow,
      like: params.like ?? currentPrefs.like,
      mention: params.mention ?? currentPrefs.mention,
      reply: params.reply ?? currentPrefs.reply,
      repost: params.repost ?? currentPrefs.repost,
      quote: params.quote ?? currentPrefs.quote,
      likeViaRepost: params.likeViaRepost ?? currentPrefs.likeViaRepost,
      repostViaRepost: params.repostViaRepost ?? currentPrefs.repostViaRepost,
      starterpackJoined:
        params.starterpackJoined ?? currentPrefs.starterpackJoined,
      subscribedPost: params.subscribedPost ?? currentPrefs.subscribedPost,
      unverified: params.unverified ?? currentPrefs.unverified,
      verified: params.verified ?? currentPrefs.verified,
    };

    // Update preferences in database
    await storage.updateUserPreferences(userDid, {
      notificationPreferencesV2: updatedPrefs,
    } as any);

    // Return preferences in ATProto format (object, not array)
    res.json({
      preferences: {
        $type: 'app.bsky.notification.defs#preferences',
        ...updatedPrefs,
      },
    });
  } catch (error) {
    handleError(res, error, 'putNotificationPreferencesV2');
  }
}

/**
 * Get notification preferences (V2)
 * GET /xrpc/app.bsky.notification.getPreferencesV2
 *
 * Returns full notification preferences for all 13 categories
 *
 * NOTE: Unlike app.bsky.actor.getPreferences (which retrieves general account preferences
 * from the PDS), notification preferences are stored on the AppView because they control
 * how THIS AppView delivers notifications to the user.
 *
 * Architectural rationale:
 * - Notification preferences are service-level settings specific to each AppView instance
 * - These settings control how the AppView processes and filters notifications
 * - The AppView needs direct access to these preferences to deliver notifications
 * - These are NOT portable user preferences that should travel between services
 *
 * Per ATProto architecture, this pattern is acknowledged as "not ideal" but is the
 * current design for notification delivery services. The app.bsky.notification.*
 * namespace is intentionally distinct from app.bsky.actor.* to reflect this difference.
 */
export async function getNotificationPreferencesV2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const userPrefs = await storage.getUserPreferences(userDid);

    // Get notification preferences V2 (or use defaults)
    const prefs = (userPrefs as any)?.notificationPreferencesV2 || {
      chat: { include: 'accepted', push: true },
      follow: { list: true, push: true, include: 'all' },
      like: { list: true, push: false, include: 'follows' },
      mention: { list: true, push: true, include: 'all' },
      reply: { list: true, push: true, include: 'all' },
      repost: { list: true, push: false, include: 'follows' },
      quote: { list: true, push: true, include: 'all' },
      likeViaRepost: { list: false, push: false, include: 'all' },
      repostViaRepost: { list: false, push: false, include: 'all' },
      starterpackJoined: { list: true, push: false },
      subscribedPost: { list: true, push: true },
      unverified: { list: true, push: false },
      verified: { list: true, push: true },
    };

    res.json({
      preferences: {
        $type: 'app.bsky.notification.defs#preferences',
        ...prefs,
      },
    });
  } catch (error) {
    handleError(res, error, 'getNotificationPreferencesV2');
  }
}

/**
 * List activity subscriptions
 * GET /xrpc/app.bsky.notification.listActivitySubscriptions
 *
 * Returns profile views of accounts the user has subscribed to for activity notifications
 * Per ATProto spec: "Enumerate all accounts to which the requesting account is subscribed to receive notifications for."
 */
export async function listActivitySubscriptions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = listActivitySubscriptionsSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get activity subscriptions (accounts user is subscribed to)
    const result = await storage.getActivitySubscriptions(
      userDid,
      params.limit,
      params.cursor
    );

    // Extract subject DIDs (accounts user is subscribed to)
    const subjectDids = result.subscriptions.map((sub) => sub.subjectDid);

    if (subjectDids.length === 0) {
      res.json({
        subscriptions: [],
        cursor: result.cursor,
      });
      return;
    }

    // Get full profile views for subscribed accounts
    const { xrpcApi } = await import('../../xrpc-api');
    const profiles = await (xrpcApi as any)._getProfiles(subjectDids, req);

    res.json({
      subscriptions: profiles,
      cursor: result.cursor,
    });
  } catch (error) {
    handleError(res, error, 'listActivitySubscriptions');
  }
}

/**
 * Update activity subscription
 * POST /xrpc/app.bsky.notification.putActivitySubscription
 *
 * Creates or updates an activity subscription for a specific account
 * Per ATProto spec: "Puts an activity subscription entry. The key should be omitted for creation and provided for updates."
 */
export async function putActivitySubscription(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = putActivitySubscriptionSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Validate that subject is a valid DID
    if (!body.subject || !body.subject.startsWith('did:')) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'Subject must be a valid DID',
      });
      return;
    }

    // Check if subject user exists
    const subjectUser = await storage.getUser(body.subject);
    if (!subjectUser) {
      res.status(404).json({
        error: 'NotFound',
        message: 'Subject account not found',
      });
      return;
    }

    // Create AT URI for the activity subscription
    // Format: at://{subscriberDid}/app.bsky.notification.activitySubscription/{rkey}
    // Use subjectDid as rkey for uniqueness
    const rkey = body.subject.replace(/[^a-zA-Z0-9]/g, '-');
    const uri = `at://${userDid}/app.bsky.notification.activitySubscription/${rkey}`;

    // Generate a CID (in production, this would be calculated from the record)
    const cid = `bafyrei${Buffer.from(`${uri}-${Date.now()}`).toString('base64url').slice(0, 44)}`;

    // Check if subscription already exists
    const existing = await storage.getActivitySubscription(uri);

    if (existing) {
      // Update existing subscription
      // Note: For now, we don't have an update method, so we'll delete and recreate
      await storage.deleteActivitySubscription(uri);
    }

    // Create/update the activity subscription
    const subscription = await storage.createActivitySubscription({
      uri,
      cid,
      subscriberDid: userDid,
      subjectDid: body.subject,
      priority:
        body.activitySubscription.post || body.activitySubscription.reply,
      createdAt: new Date(),
    });

    // Get profile view for the subject
    const { xrpcApi } = await import('../../xrpc-api');
    const profiles = await (xrpcApi as any)._getProfiles([body.subject], req);

    res.json({
      subject: body.subject,
      activitySubscription: {
        post: body.activitySubscription.post,
        reply: body.activitySubscription.reply,
      },
      // Return profile view for convenience
      profile: profiles[0] || null,
    });
  } catch (error) {
    handleError(res, error, 'putActivitySubscription');
  }
}
