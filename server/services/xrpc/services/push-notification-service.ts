/**
 * Push Notification Service
 * Handles push notification subscription registration and unregistration
 */

import type { Request, Response } from 'express';
import { storage } from '../../storage';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { registerPushSchema, unregisterPushSchema } from '../schemas';

/**
 * Register a push notification subscription
 * POST /xrpc/app.bsky.notification.registerPush
 */
export async function registerPush(req: Request, res: Response): Promise<void> {
  try {
    const params = registerPushSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Create or update push subscription
    const subscription = await storage.createPushSubscription({
      userDid,
      platform: params.platform,
      token: params.token,
      appId: params.appId,
    } as {
      userDid: string;
      platform: string;
      token: string;
      appId?: string;
    });

    res.json({
      id: (subscription as { id: string }).id,
      platform: (subscription as { platform: string }).platform,
      createdAt: (subscription as { createdAt: Date }).createdAt.toISOString(),
    });
  } catch (error) {
    handleError(res, error, 'registerPush');
  }
}

/**
 * Unregister a push notification subscription
 * POST /xrpc/app.bsky.notification.unregisterPush
 */
export async function unregisterPush(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = unregisterPushSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;
    await storage.deletePushSubscriptionByToken(params.token);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'unregisterPush');
  }
}
