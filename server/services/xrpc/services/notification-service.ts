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
      params.cursor
    );
    console.log(
      `[listNotifications] Found ${notificationsList.length} notifications`
    );

    // Collect all reasonSubject URIs (posts being interacted with)
    const postUris = notificationsList
      .map((n) => (n as { reasonSubject?: string }).reasonSubject)
      .filter((uri): uri is string => !!uri);

    if (postUris.length > 0) {
      // Check which posts exist
      const existingPosts = await storage.getPosts(postUris);
      const existingUris = new Set(existingPosts.map((p) => p.uri));
      const missingUris = postUris.filter((uri) => !existingUris.has(uri));

      if (missingUris.length > 0) {
        console.log(
          `[listNotifications] ${missingUris.length} notification posts not in database, triggering backfill`
        );

        // Trigger background backfill for missing posts
        import('../../auto-backfill-likes')
          .then(({ autoBackfillLikesService }) => {
            autoBackfillLikesService
              .checkAndBackfill(userDid)
              .catch((err) =>
                console.error(
                  '[listNotifications] Error triggering backfill:',
                  err
                )
              );
          })
          .catch((err) =>
            console.error(
              '[listNotifications] Error importing backfill:',
              err
            )
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
          try {
            // For post-related notifications, check if the post still exists
            if (
              notification.reason === 'like' ||
              notification.reason === 'repost' ||
              notification.reason === 'reply' ||
              notification.reason === 'quote'
            ) {
              const post = await storage.getPost(reasonSubject);
              if (!post) {
                // Post was deleted, filter out this notification
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
          } catch (error) {
            console.warn(
              '[NOTIFICATIONS] Failed to fetch record for subject:',
              { reasonSubject },
              error
            );
            // If we can't fetch the record, filter out this notification
            return null;
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
            associated: {
              $type: 'app.bsky.actor.defs#profileAssociated',
              lists: 0,
              feedgens: 0,
              starterPacks: 0,
              labeler: false,
              chat: undefined,
              activitySubscription: undefined,
            },
            viewer: {
              $type: 'app.bsky.actor.defs#viewerState',
              muted: false,
              mutedByList: undefined,
              blockedBy: false,
              blocking: undefined,
              blockingByList: undefined,
              following: undefined,
              followedBy: undefined,
              knownFollowers: undefined,
              activitySubscription: undefined,
            },
            labels: [],
            createdAt: authorData.createdAt?.toISOString(),
            verification: undefined,
            status: undefined,
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
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;
    const count = await storage.getUnreadNotificationCount(userDid);
    res.json({ count });
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
    await storage.markNotificationsAsRead(
      userDid,
      params.seenAt ? new Date(params.seenAt) : undefined
    );
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'updateSeen');
  }
}

/**
 * Get notification preferences
 * GET /xrpc/app.bsky.notification.getPreferences
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
 */
export async function putNotificationPreferencesV2(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = putNotificationPreferencesV2Schema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;
    let prefs = await storage.getUserPreferences(userDid);
    if (!prefs) {
      prefs = await storage.createUserPreferences({
        userDid,
        notificationPriority: !!params.priority,
      } as {
        userDid: string;
        notificationPriority: boolean;
      });
    } else {
      prefs = await storage.updateUserPreferences(userDid, {
        notificationPriority:
          params.priority ??
          (prefs as { notificationPriority: boolean }).notificationPriority,
      });
    }
    res.json({
      preferences: [
        {
          $type: 'app.bsky.notification.defs#preferences',
          priority:
            (prefs as { notificationPriority?: boolean })
              ?.notificationPriority ?? false,
        },
      ],
    });
  } catch (error) {
    handleError(res, error, 'putNotificationPreferencesV2');
  }
}

/**
 * List activity subscriptions
 * GET /xrpc/app.bsky.notification.listActivitySubscriptions
 */
export async function listActivitySubscriptions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    listActivitySubscriptionsSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;
    const subs = await storage.getUserPushSubscriptions(userDid);
    res.json({
      subscriptions: (
        subs as {
          id: string;
          platform: string;
          appId?: string;
          createdAt: Date;
          updatedAt: Date;
        }[]
      ).map((s) => ({
        id: s.id,
        platform: s.platform,
        appId: s.appId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    handleError(res, error, 'listActivitySubscriptions');
  }
}

/**
 * Update activity subscription
 * POST /xrpc/app.bsky.notification.putActivitySubscription
 */
export async function putActivitySubscription(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = putActivitySubscriptionSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;
    // Upsert a synthetic web subscription for parity
    await storage.createPushSubscription({
      userDid,
      platform: 'web',
      token: `activity-${userDid}`,
      endpoint: undefined,
      keys: undefined,
      appId: body.subject || undefined,
    } as {
      userDid: string;
      platform: string;
      token: string;
      endpoint?: string;
      keys?: string;
      appId?: string;
    });
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'putActivitySubscription');
  }
}
