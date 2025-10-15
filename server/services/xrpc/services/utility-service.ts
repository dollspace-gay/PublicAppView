/**
 * Utility Service
 * Handles miscellaneous endpoints: labeler services, video jobs, upload limits, interactions
 */

import type { Request, Response } from 'express';
import { storage } from '../../storage';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { transformBlobToCdnUrl } from '../utils/serializers';
import {
  getLabelerServicesSchema,
  getJobStatusSchema,
  sendInteractionsSchema,
} from '../schemas/utility-schemas';

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
    const services = allServices.flat();

    const views = await Promise.all(
      services.map(async (service) => {
        const creator = await storage.getUser(
          (service as { creatorDid: string }).creatorDid
        );

        // Skip services from creators without valid handles
        if (!creator || !creator.handle) {
          console.warn(
            `[XRPC] Skipping labeler service ${(service as { uri: string }).uri} - creator ${(service as { creatorDid: string }).creatorDid} has no handle`
          );
          return null;
        }

        const creatorView: {
          did: string;
          handle: string;
          displayName?: string;
          avatar?: string;
        } = {
          did: (service as { creatorDid: string }).creatorDid,
          handle: creator.handle,
        };

        if (creator?.displayName) creatorView.displayName = creator.displayName;
        if (creator?.avatarUrl) {
          const avatarUri = transformBlobToCdnUrl(
            creator.avatarUrl,
            creator.did,
            'avatar',
            req
          );
          if (
            avatarUri &&
            typeof avatarUri === 'string' &&
            avatarUri.trim() !== ''
          ) {
            creatorView.avatar = avatarUri;
          }
        }

        const view: {
          uri: string;
          cid: string;
          creator: typeof creatorView;
          likeCount: number;
          indexedAt: string;
          policies?: unknown;
          labels?: unknown[];
        } = {
          uri: (service as { uri: string }).uri,
          cid: (service as { cid: string }).cid,
          creator: creatorView,
          likeCount: (service as { likeCount: number }).likeCount,
          indexedAt: (service as { indexedAt: Date }).indexedAt.toISOString(),
        };

        // Add policies
        if ((service as { policies?: unknown }).policies) {
          view.policies = (service as { policies: unknown }).policies;
        }

        // Get labels applied to this labeler service
        const labels = await storage.getLabelsForSubject(
          (service as { uri: string }).uri
        );
        if (labels.length > 0) {
          view.labels = labels.map((label) => {
            const labelView: {
              src: string;
              uri: string;
              val: string;
              cts: string;
              neg?: boolean;
            } = {
              src: (label as { src: string }).src,
              uri: (label as { subject: string }).subject,
              val: (label as { val: string }).val,
              cts: (label as { createdAt: Date }).createdAt.toISOString(),
            };
            if ((label as { neg?: boolean }).neg) labelView.neg = true;
            return labelView;
          });
        }

        return view;
      })
    );

    // Filter out null entries (services from creators without valid handles)
    const validViews = views.filter((view) => view !== null);

    res.json({ views: validViews });
  } catch (error) {
    handleError(res, error, 'getServices');
  }
}

/**
 * Get video job status
 * GET /xrpc/app.bsky.video.getJobStatus
 */
export async function getJobStatus(req: Request, res: Response): Promise<void> {
  try {
    const params = getJobStatusSchema.parse(req.query);

    // Get video job
    const job = await storage.getVideoJob(params.jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Build response
    const response: {
      jobId: string;
      did: string;
      state: string;
      progress: number;
      blob?: unknown;
      error?: string;
    } = {
      jobId: (job as { jobId: string }).jobId,
      did: (job as { userDid: string }).userDid,
      state: (job as { state: string }).state,
      progress: (job as { progress: number }).progress,
    };

    // Add optional fields
    if ((job as { blobRef?: unknown }).blobRef) {
      response.blob = (job as { blobRef: unknown }).blobRef;
    }

    if ((job as { error?: string }).error) {
      response.error = (job as { error: string }).error;
    }

    res.json({ jobStatus: response });
  } catch (error) {
    handleError(res, error, 'getJobStatus');
  }
}

/**
 * Get video upload limits
 * GET /xrpc/app.bsky.video.getUploadLimits
 */
export async function getUploadLimits(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const DAILY_VIDEO_LIMIT = Number(process.env.VIDEO_DAILY_LIMIT || 10);
    const DAILY_BYTES_LIMIT = Number(
      process.env.VIDEO_DAILY_BYTES || 100 * 1024 * 1024
    );

    const todayJobs = await storage.getUserVideoJobs(userDid, 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const usedVideos = todayJobs.filter(
      (j) => (j as { createdAt: Date }).createdAt >= today
    ).length;
    const canUpload = usedVideos < DAILY_VIDEO_LIMIT;

    res.json({
      canUpload,
      remainingDailyVideos: Math.max(0, DAILY_VIDEO_LIMIT - usedVideos),
      remainingDailyBytes: DAILY_BYTES_LIMIT,
      message: canUpload ? undefined : 'Daily upload limit reached',
      error: undefined,
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
    for (const _ of (body as { interactions: unknown[] }).interactions) {
      metricsService.recordApiRequest();
    }

    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'sendInteractions');
  }
}
