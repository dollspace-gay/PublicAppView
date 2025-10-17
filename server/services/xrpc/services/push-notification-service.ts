/**
 * Push Notification Service
 * Handles push notification subscription registration and unregistration
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
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

    // Validate serviceDid matches this AppView's DID (if configured)
    // For now, we accept any serviceDid as this AppView handles push for all users
    // In production, you might want to validate: params.serviceDid === process.env.SERVICE_DID

    // Create or update push subscription
    await storage.createPushSubscription({
      userDid,
      platform: params.platform,
      token: params.token,
      appId: params.appId,
      endpoint: params.endpoint,
      keys: params.keys ? JSON.stringify(params.keys) : undefined,
    } as {
      userDid: string;
      platform: string;
      token: string;
      appId?: string;
      endpoint?: string;
      keys?: string;
    });

    // AT Protocol spec: return empty object on success
    res.json({});
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

    // Validate serviceDid matches this AppView's DID (if configured)
    const serviceDid = process.env.SERVICE_DID;
    if (serviceDid && params.serviceDid !== serviceDid) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'serviceDid does not match this service',
      });
      return;
    }

    // Delete push subscription with full validation
    // Ensures user can only unregister their own devices
    await storage.deletePushSubscriptionByDetails(
      userDid,
      params.token,
      params.platform,
      params.appId
    );

    // AT Protocol spec: return empty object on success
    res.json({});
  } catch (error) {
    handleError(res, error, 'unregisterPush');
  }
}
