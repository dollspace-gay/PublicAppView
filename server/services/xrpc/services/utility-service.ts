/**
 * Utility Service
 * Handles miscellaneous endpoints: labeler services, video jobs, upload limits, interactions
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { transformBlobToCdnUrl } from '../utils/serializers';
import {
  getLabelerServicesSchema,
  getJobStatusSchema,
  sendInteractionsSchema,
} from '../schemas/utility-schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get labeler services for given DIDs
 * GET /xrpc/app.bsky.labeler.getServices
 */
export async function getServices(req: Request, res: Response): Promise<void> {
  try {
    const params = getLabelerServicesSchema.parse(req.query);

    // Get all labeler services for the requested DIDs
    const allServices = await Promise.all(
      params.dids.map(async (did: string) => {
        const services = await storage.getLabelerServicesByCreator(did);
        return services;
      })
    );

    // Flatten array of arrays
    const services = allServices.flat() as {
      uri: string;
      cid: string;
      creatorDid: string;
      likeCount: number;
      indexedAt: Date;
      policies?: unknown;
    }[];

    if (services.length === 0) {
      return res.json({ views: [] });
    }

    // Batch fetch all creator profiles
    const creatorDids = [...new Set(services.map((s) => s.creatorDid))];
    const creatorProfiles = await (xrpcApi as any)._getProfiles(
      creatorDids,
      req
    );

    // Create map for quick lookup
    const profileMap = new Map(creatorProfiles.map((p: any) => [p.did, p]));

    // Batch fetch labels for all services
    const serviceUris = services.map((s) => s.uri);
    const allLabels = await storage.getLabelsForSubjects(serviceUris);

    // Create labels map
    const labelsMap = new Map<string, typeof allLabels>();
    allLabels.forEach((label) => {
      const existing = labelsMap.get(label.subject) || [];
      existing.push(label);
      labelsMap.set(label.subject, existing);
    });

    // Build views
    const views = services
      .map((service) => {
        const creatorProfile = profileMap.get(service.creatorDid);
        if (!creatorProfile) {
          console.warn(
            `[XRPC] Skipping labeler service ${service.uri} - creator ${service.creatorDid} profile not found`
          );
          return null;
        }

        const view: any = {
          uri: service.uri,
          cid: service.cid,
          creator: creatorProfile, // Full profileView
          likeCount: service.likeCount || 0,
          indexedAt: service.indexedAt.toISOString(),
        };

        // Add policies (required for detailed view, optional for basic view)
        if (params.detailed && service.policies) {
          view.policies = service.policies;
        }

        // Add labels
        const serviceLabels = labelsMap.get(service.uri);
        if (serviceLabels && serviceLabels.length > 0) {
          view.labels = serviceLabels.map((label) => ({
            src: label.src,
            uri: label.subject,
            val: label.val,
            cts: label.createdAt.toISOString(),
            ...(label.neg && { neg: true }),
          }));
        }

        return view;
      })
      .filter(Boolean);

    res.json({ views });
  } catch (error) {
    handleError(res, error, 'getServices');
  }
}

/**
 * Get video job status
 * GET /xrpc/app.bsky.video.getJobStatus
 *
 * NOTE: This endpoint is for video processing services, not AppView.
 * Per ATProto architecture, video processing is handled by dedicated video services
 * (e.g., video.bsky.app) that manage video transcoding, storage, and job tracking.
 *
 * AppView aggregates public data but does not process videos or maintain video job state.
 * Users should interact with video services directly or via PDS proxy using service auth.
 */
export async function getJobStatus(req: Request, res: Response): Promise<void> {
  try {
    getJobStatusSchema.parse(req.query);

    res.status(501).json({
      error: 'NotImplemented',
      message:
        'This endpoint is for video processing services, not AppView. ' +
        'Video processing (upload, transcoding, job tracking) is handled by dedicated video services. ' +
        'Please use a video service endpoint (e.g., video.bsky.app) directly or via PDS proxy with service auth.',
    });
  } catch (error) {
    handleError(res, error, 'getJobStatus');
  }
}

/**
 * Get video upload limits
 * GET /xrpc/app.bsky.video.getUploadLimits
 *
 * NOTE: This endpoint is for video processing services, not AppView.
 * Per ATProto architecture, video upload quotas and limits are managed by dedicated
 * video services (e.g., video.bsky.app) that handle video processing and storage.
 *
 * AppView aggregates public data but does not manage user-specific video upload quotas.
 * Users should check upload limits via video service endpoint or via PDS proxy with service auth.
 */
export async function getUploadLimits(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    res.status(501).json({
      error: 'NotImplemented',
      message:
        'This endpoint is for video processing services, not AppView. ' +
        'Video upload limits are managed by dedicated video services. ' +
        'Please use a video service endpoint (e.g., video.bsky.app) directly or via PDS proxy with service auth.',
    });
  } catch (error) {
    handleError(res, error, 'getUploadLimits');
  }
}

/**
 * Send user interactions for analytics
 * POST /xrpc/app.bsky.feed.sendInteractions
 */
export async function sendInteractions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = sendInteractionsSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Record basic metrics; future: persist interactions for ranking signals
    const { metricsService } = await import('../../metrics');
    for (const _ of body.interactions) {
      metricsService.recordApiRequest();
    }

    // AT Protocol spec: return empty object
    res.json({});
  } catch (error) {
    handleError(res, error, 'sendInteractions');
  }
}
