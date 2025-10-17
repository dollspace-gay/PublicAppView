/**
 * Moderation Service
 * Handles moderation actions: blocks, mutes, reports, and labels
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { resolveActor, getUserPdsEndpoint } from '../utils/resolvers';
import { maybeAvatar } from '../utils/serializers';
import {
  getBlocksSchema,
  getMutesSchema,
  muteActorSchema,
  muteActorListSchema,
  unmuteActorListSchema,
  muteThreadSchema,
  queryLabelsSchema,
  createReportSchema,
} from '../schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get blocked actors
 * GET /xrpc/app.bsky.graph.getBlocks
 */
export async function getBlocks(req: Request, res: Response): Promise<void> {
  try {
    const params = getBlocksSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const { blocks, cursor } = await storage.getBlocks(
      userDid,
      params.limit,
      params.cursor
    );

    if (blocks.length === 0) {
      return res.json({
        cursor,
        blocks: [],
      });
    }

    const blockedDids = blocks.map((b) => b.blockedDid);

    // Use _getProfiles helper to build complete profileView objects
    const profiles = await (xrpcApi as any)._getProfiles(blockedDids, req);

    // Create a map of DID -> profile for quick lookup
    const profileMap = new Map(profiles.map((p: any) => [p.did, p]));

    // Build blocks array with full profileView objects and viewer state
    const blocksWithProfiles = blocks
      .map((b) => {
        const profile = profileMap.get(b.blockedDid);
        if (!profile) return null;

        // Ensure viewer.blocking is set correctly
        return {
          ...profile,
          viewer: {
            ...profile.viewer,
            blocking: b.uri, // Override with the specific block URI
          },
        };
      })
      .filter(Boolean);

    res.json({
      cursor,
      blocks: blocksWithProfiles,
    });
  } catch (error) {
    handleError(res, error, 'getBlocks');
  }
}

/**
 * Get muted actors
 * GET /xrpc/app.bsky.graph.getMutes
 *
 * NOTE: Per ATProto architecture, mutes are private user preferences
 * that belong on the PDS, NOT the AppView. Unlike blocks (which are public
 * records), mutes are private metadata affecting content filtering.
 *
 * Returns error directing client to fetch from PDS directly.
 */
export async function getMutes(req: Request, res: Response): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Mutes must be fetched directly from your PDS, not through the AppView. ' +
               'Per ATProto architecture, mutes are private user preferences stored on the PDS. ' +
               'Unlike blocks (which are public records), mutes are private metadata. ' +
               (pdsEndpoint
                 ? `Please fetch from: ${pdsEndpoint}/xrpc/app.bsky.graph.getMutes`
                 : 'Please fetch from your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'getMutes');
  }
}

/**
 * Mute an actor
 * POST /xrpc/app.bsky.graph.muteActor
 *
 * NOTE: Per ATProto architecture, mutes are private user preferences
 * that belong on the PDS, NOT the AppView.
 *
 * Returns error directing client to create mute on PDS directly.
 */
export async function muteActor(req: Request, res: Response): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Mutes must be created directly on your PDS, not through the AppView. ' +
               'Per ATProto architecture, mutes are private user preferences stored on the PDS. ' +
               (pdsEndpoint
                 ? `Please create mute at: ${pdsEndpoint}/xrpc/app.bsky.graph.muteActor`
                 : 'Please create mute on your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'muteActor');
  }
}

/**
 * Unmute an actor
 * POST /xrpc/app.bsky.graph.unmuteActor
 *
 * NOTE: Per ATProto architecture, mutes are private user preferences
 * that belong on the PDS, NOT the AppView.
 *
 * Returns error directing client to delete mute on PDS directly.
 */
export async function unmuteActor(req: Request, res: Response): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Mutes must be removed directly on your PDS, not through the AppView. ' +
               'Per ATProto architecture, mutes are private user preferences stored on the PDS. ' +
               (pdsEndpoint
                 ? `Please remove mute at: ${pdsEndpoint}/xrpc/app.bsky.graph.unmuteActor`
                 : 'Please remove mute on your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'unmuteActor');
  }
}

/**
 * Mute a list
 * POST /xrpc/app.bsky.graph.muteActorList
 *
 * NOTE: Per ATProto architecture, list mutes are private user preferences
 * that belong on the PDS, NOT the AppView.
 *
 * Returns error directing client to create list mute on PDS directly.
 */
export async function muteActorList(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'List mutes must be created directly on your PDS, not through the AppView. ' +
               'Per ATProto architecture, mutes are private user preferences stored on the PDS. ' +
               (pdsEndpoint
                 ? `Please create list mute at: ${pdsEndpoint}/xrpc/app.bsky.graph.muteActorList`
                 : 'Please create list mute on your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'muteActorList');
  }
}

/**
 * Unmute a list
 * POST /xrpc/app.bsky.graph.unmuteActorList
 *
 * NOTE: Per ATProto architecture, list mutes are private user preferences
 * that belong on the PDS, NOT the AppView.
 *
 * Returns error directing client to delete list mute on PDS directly.
 */
export async function unmuteActorList(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'List mutes must be removed directly on your PDS, not through the AppView. ' +
               'Per ATProto architecture, mutes are private user preferences stored on the PDS. ' +
               (pdsEndpoint
                 ? `Please remove list mute at: ${pdsEndpoint}/xrpc/app.bsky.graph.unmuteActorList`
                 : 'Please remove list mute on your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'unmuteActorList');
  }
}

/**
 * Mute a thread
 * POST /xrpc/app.bsky.graph.muteThread
 *
 * NOTE: Per ATProto architecture, thread mutes are private user preferences
 * that belong on the PDS, NOT the AppView.
 *
 * Returns error directing client to create thread mute on PDS directly.
 */
export async function muteThread(req: Request, res: Response): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Thread mutes must be created directly on your PDS, not through the AppView. ' +
               'Per ATProto architecture, mutes are private user preferences stored on the PDS. ' +
               (pdsEndpoint
                 ? `Please create thread mute at: ${pdsEndpoint}/xrpc/app.bsky.graph.muteThread`
                 : 'Please create thread mute on your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'muteThread');
  }
}

/**
 * Unmute a thread
 * POST /xrpc/app.bsky.graph.unmuteThread
 *
 * NOTE: Per ATProto architecture, thread mutes are private user preferences
 * that belong on the PDS, NOT the AppView.
 *
 * Returns error directing client to remove thread mute on PDS directly.
 */
export async function unmuteThread(req: Request, res: Response): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Get user's PDS endpoint to include in error message
    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Thread mutes must be removed directly on your PDS, not through the AppView. ' +
               'Per ATProto architecture, mutes are private user preferences stored on the PDS. ' +
               (pdsEndpoint
                 ? `Please remove thread mute at: ${pdsEndpoint}/xrpc/app.bsky.graph.unmuteThread`
                 : 'Please remove thread mute on your PDS using your PDS token.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'unmuteThread');
  }
}

/**
 * Query labels for subjects
 * GET /xrpc/com.atproto.label.queryLabels
 */
export async function queryLabels(req: Request, res: Response): Promise<void> {
  try {
    const params = queryLabelsSchema.parse(req.query);
    const subjects = params.uriPatterns ?? [];

    // Validate wildcard usage
    if (subjects.some((u) => u.includes('*'))) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'wildcards not supported',
      });
      return;
    }

    // Sources are optional - if not provided, return labels from all sources
    const sources = params.sources;

    // Use the proper storage.queryLabels method which handles filtering in DB
    const labels = await storage.queryLabels({
      subjects: subjects.length > 0 ? subjects : undefined,
      sources: sources && sources.length > 0 ? sources : undefined,
      limit: params.limit,
    });

    // Note: Cursor-based pagination not yet implemented in storage layer
    // AT Protocol spec allows cursor to be undefined if pagination not supported
    res.json({ cursor: undefined, labels });
  } catch (error) {
    handleError(res, error, 'queryLabels');
  }
}

/**
 * Create a moderation report
 * POST /xrpc/com.atproto.moderation.createReport
 */
export async function createReport(req: Request, res: Response): Promise<void> {
  try {
    const params = createReportSchema.parse(req.body);

    // Require authentication - reports must be from known users
    const reporterDid = await requireAuthDid(req, res);
    if (!reporterDid) return;

    // Determine subject and subjectType from the subject object
    let subject: string;
    let subjectType: 'post' | 'account' | 'message';

    if (params.subject.uri) {
      subject = params.subject.uri;
      // Determine type from URI
      if (params.subject.uri.includes('app.bsky.feed.post')) {
        subjectType = 'post';
      } else if (params.subject.uri.includes('chat.bsky.convo.message')) {
        subjectType = 'message';
      } else {
        // Default to post for other URIs
        subjectType = 'post';
      }
    } else if (params.subject.did) {
      subject = params.subject.did;
      subjectType = 'account';
    } else {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'subject must contain either uri or did',
      });
      return;
    }

    const report = await storage.createModerationReport({
      reporterDid,
      reportType: params.reasonType, // Note: DB field is 'reportType' not 'reasonType'
      reason: params.reason || null,
      subject,
      subjectType,
      status: 'pending', // Use correct default status
      createdAt: new Date(),
    });

    res.json({
      id: report.id,
      reasonType: report.reportType,
      reason: report.reason,
      subject: {
        $type: params.subject.$type,
        uri: params.subject.uri,
        did: params.subject.did,
        cid: params.subject.cid,
      },
      reportedBy: reporterDid,
      createdAt: report.createdAt.toISOString(),
    });
  } catch (error) {
    handleError(res, error, 'createReport');
  }
}
