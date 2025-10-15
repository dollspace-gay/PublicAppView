/**
 * Moderation Service
 * Handles moderation actions: blocks, mutes, reports, and labels
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
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
    const blockedDids = blocks.map((b) => b.blockedDid);
    const blockedUsers = await storage.getUsers(blockedDids);
    const userMap = new Map(blockedUsers.map((u) => [u.did, u]));

    res.json({
      cursor,
      blocks: blocks
        .map((b) => {
          const user = userMap.get(b.blockedDid);
          if (!user) return null;
          return {
            did: user.did,
            handle: user.handle,
            displayName: user.displayName || user.handle,
            ...maybeAvatar(user.avatarUrl, user.did, req),
            viewer: {
              blocking: b.uri,
              muted: false,
            },
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    handleError(res, error, 'getBlocks');
  }
}

/**
 * Get muted actors
 * GET /xrpc/app.bsky.graph.getMutes
 */
export async function getMutes(req: Request, res: Response): Promise<void> {
  try {
    const params = getMutesSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const { mutes, cursor } = await storage.getMutes(
      userDid,
      params.limit,
      params.cursor
    );
    const mutedDids = mutes.map((m) => m.mutedDid);
    const mutedUsers = await storage.getUsers(mutedDids);
    const userMap = new Map(mutedUsers.map((u) => [u.did, u]));

    res.json({
      cursor,
      mutes: mutes
        .map((m) => {
          const user = userMap.get(m.mutedDid);
          if (!user) return null;
          return {
            did: user.did,
            handle: user.handle,
            displayName: user.displayName || user.handle,
            ...maybeAvatar(user.avatarUrl, user.did, req),
            viewer: {
              muted: true,
            },
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    handleError(res, error, 'getMutes');
  }
}

/**
 * Mute an actor
 * POST /xrpc/app.bsky.graph.muteActor
 */
export async function muteActor(req: Request, res: Response): Promise<void> {
  try {
    const params = muteActorSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const mutedDid = await resolveActor(res, params.actor);
    if (!mutedDid) return;

    await storage.createMute({
      uri: `at://${userDid}/app.bsky.graph.mute/${Date.now()}`,
      muterDid: userDid,
      mutedDid,
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'muteActor');
  }
}

/**
 * Unmute an actor
 * POST /xrpc/app.bsky.graph.unmuteActor
 */
export async function unmuteActor(req: Request, res: Response): Promise<void> {
  try {
    const params = muteActorSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const mutedDid = await resolveActor(res, params.actor);
    if (!mutedDid) return;

    const { mutes } = await storage.getMutes(userDid, 1000);
    const mute = mutes.find((m) => m.mutedDid === mutedDid);

    if (mute) {
      await storage.deleteMute(mute.uri);
    }

    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'unmuteActor');
  }
}

/**
 * Mute a list
 * POST /xrpc/app.bsky.graph.muteActorList
 */
export async function muteActorList(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = muteActorListSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Verify list exists
    const list = await storage.getList(params.list);
    if (!list) {
      res.status(404).json({ error: 'List not found' });
      return;
    }

    await storage.createListMute({
      uri: `at://${userDid}/app.bsky.graph.listMute/${Date.now()}`,
      muterDid: userDid,
      listUri: params.list,
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'muteActorList');
  }
}

/**
 * Unmute a list
 * POST /xrpc/app.bsky.graph.unmuteActorList
 */
export async function unmuteActorList(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = unmuteActorListSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const { mutes } = await storage.getListMutes(userDid, 1000);
    const mute = mutes.find((m) => m.listUri === params.list);

    if (mute) {
      await storage.deleteListMute(mute.uri);
    }

    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'unmuteActorList');
  }
}

/**
 * Mute a thread
 * POST /xrpc/app.bsky.graph.muteThread
 */
export async function muteThread(req: Request, res: Response): Promise<void> {
  try {
    const params = muteThreadSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // Verify thread root post exists
    const rootPost = await storage.getPost(params.root);
    if (!rootPost) {
      res.status(404).json({ error: 'Thread root post not found' });
      return;
    }

    // Create thread mute
    await storage.createThreadMute({
      uri: `at://${userDid}/app.bsky.graph.threadMute/${Date.now()}`,
      muterDid: userDid,
      threadRootUri: params.root,
      createdAt: new Date(),
    });

    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'muteThread');
  }
}

/**
 * Unmute a thread
 * POST /xrpc/app.bsky.graph.unmuteThread
 */
export async function unmuteThread(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = muteThreadSchema.parse(req.body);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const { mutes } = await storage.getThreadMutes(userDid, 1000);
    const existing = mutes.find((m) => m.threadRootUri === body.root);
    
    if (existing) {
      await storage.deleteThreadMute(existing.uri);
    }

    res.json({ success: true });
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
    
    if (subjects.some((u) => u.includes('*'))) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'wildcards not supported',
      });
      return;
    }

    const sources = params.sources ?? [];
    if (sources.length === 0) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'source dids are required',
      });
      return;
    }

    const labels = await storage.getLabelsForSubjects(subjects);
    const filtered = labels.filter((l) => sources.includes(l.src));
    
    res.json({ cursor: undefined, labels: filtered });
  } catch (error) {
    handleError(res, error, 'queryLabels');
  }
}

/**
 * Create a moderation report
 * POST /xrpc/com.atproto.moderation.createReport
 */
export async function createReport(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = createReportSchema.parse(req.body);
    const reporterDid =
      (await getAuthenticatedDid(req)) ||
      (req as any).user?.did ||
      'did:unknown:anonymous';

    const report = await storage.createModerationReport({
      reporterDid,
      reasonType: params.reasonType,
      reason: params.reason || null,
      subject:
        params.subject.uri ||
        params.subject.did ||
        params.subject.cid ||
        'unknown',
      createdAt: new Date(),
      status: 'open',
    } as any);

    res.json({ id: report.id, success: true });
  } catch (error) {
    handleError(res, error, 'createReport');
  }
}
