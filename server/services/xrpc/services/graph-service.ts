/**
 * Graph Service
 * Handles social graph operations: relationships, follows, followers
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import { maybeAvatar } from '../utils/serializers';
import {
  getRelationshipsSchema,
  getKnownFollowersSchema,
  getFollowsSchema,
} from '../schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get relationships between an actor and other actors
 * GET /xrpc/app.bsky.graph.getRelationships
 *
 * NOTE: Per ATProto spec, relationship objects only include follow relationships.
 * Blocks and mutes are intentionally excluded from this endpoint.
 * - Blocks: Public records but not exposed via getRelationships
 * - Mutes: Private preferences that should never be exposed by AppView
 */
export async function getRelationships(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getRelationshipsSchema.parse(req.query);
    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    const targetDids = params.others || [];
    const relationships = await storage.getRelationships(actorDid, targetDids);

    res.json({
      actor: actorDid,
      relationships: Array.from(relationships.entries()).map(([did, rel]) => ({
        $type: 'app.bsky.graph.defs#relationship',
        did,
        following: rel.following || undefined,
        followedBy: rel.followedBy || undefined,
        // Per ATProto spec: blocking, blockedBy, muted are NOT included
      })),
    });
  } catch (error) {
    handleError(res, error, 'getRelationships');
  }
}

/**
 * Get followers that the viewer also follows
 * GET /xrpc/app.bsky.graph.getKnownFollowers
 */
export async function getKnownFollowers(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getKnownFollowersSchema.parse(req.query);
    const viewerDid = await requireAuthDid(req, res);
    if (!viewerDid) return;

    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    const { followers, cursor } = await storage.getKnownFollowers(
      actorDid,
      viewerDid,
      params.limit,
      params.cursor
    );

    // Build full profileView objects using _getProfiles helper
    const followerDids = followers.map((f) => f.did);
    const allDids = [actorDid, ...followerDids];
    const profiles = await (xrpcApi as any)._getProfiles(allDids, req);

    // Create a map of DID -> profile for quick lookup
    const profileMap = new Map(profiles.map((p: any) => [p.did, p]));

    // Extract subject profile
    const subject = profileMap.get(actorDid);

    // Extract follower profiles in order
    const followerProfiles = followerDids
      .map((did) => profileMap.get(did))
      .filter(Boolean);

    res.json({
      subject: subject || {
        $type: 'app.bsky.actor.defs#profileView',
        did: actorDid,
        handle: actorDid,
      },
      cursor,
      followers: followerProfiles,
    });
  } catch (error) {
    handleError(res, error, 'getKnownFollowers');
  }
}

/**
 * Get accounts that an actor follows
 * GET /xrpc/app.bsky.graph.getFollows
 */
export async function getFollows(req: Request, res: Response): Promise<void> {
  try {
    const params = getFollowsSchema.parse(req.query);
    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    const { follows: followsList, cursor: nextCursor } =
      await storage.getFollows(actorDid, params.limit, params.cursor);
    const followDids = followsList.map((f) => f.followingDid);
    const followUsers = await storage.getUsers(followDids);
    const userMap = new Map(followUsers.map((u) => [u.did, u]));

    const viewerDid = await getAuthenticatedDid(req);
    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, followDids)
      : new Map();

    // Get the actor's handle for the subject
    const actor = await storage.getUser(actorDid);

    res.json({
      subject: {
        $type: 'app.bsky.actor.defs#profileView',
        did: actorDid,
        handle: actor?.handle || actorDid,
        displayName: actor?.displayName || actor?.handle || actorDid,
        ...maybeAvatar(actor?.avatarUrl, actor?.did, req),
        indexedAt: actor?.indexedAt?.toISOString(),
        viewer: {
          muted: false,
          blockedBy: false,
          blocking: undefined,
          following: undefined,
          followedBy: undefined,
        },
      },
      follows: followsList.map((f) => {
        const user = userMap.get(f.followingDid);

        // If user profile not found, create minimal profile with DID
        // This ensures follows always show up even if profile fetch is pending
        if (!user) {
          return {
            $type: 'app.bsky.actor.defs#profileView',
            did: f.followingDid,
            handle: f.followingDid, // Use DID as fallback handle
            displayName: f.followingDid,
            indexedAt: f.indexedAt?.toISOString(),
            viewer: {
              muted: false,
              blockedBy: false,
            },
          };
        }

        const viewerState = viewerDid
          ? relationships.get(f.followingDid)
          : null;
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
        if (viewerState?.followedBy)
          viewer.followedBy = viewerState.followedBy;

        return {
          $type: 'app.bsky.actor.defs#profileView',
          did: user.did,
          handle: user.handle,
          displayName: user.displayName || user.handle,
          ...maybeAvatar(user.avatarUrl, user.did, req),
          indexedAt: user.indexedAt?.toISOString(),
          viewer,
        };
      }),
      cursor: nextCursor,
    });
  } catch (error) {
    handleError(res, error, 'getFollows');
  }
}

/**
 * Get accounts that follow an actor
 * GET /xrpc/app.bsky.graph.getFollowers
 */
export async function getFollowers(req: Request, res: Response): Promise<void> {
  try {
    const params = getFollowsSchema.parse(req.query);
    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    const { followers: followersList, cursor: nextCursor } =
      await storage.getFollowers(actorDid, params.limit, params.cursor);
    const followerDids = followersList.map((f) => f.followerDid);
    const followerUsers = await storage.getUsers(followerDids);
    const userMap = new Map(followerUsers.map((u) => [u.did, u]));

    const viewerDid = await getAuthenticatedDid(req);
    const relationships = viewerDid
      ? await storage.getRelationships(viewerDid, followerDids)
      : new Map();

    // Get the actor's handle for the subject
    const actor = await storage.getUser(actorDid);

    res.json({
      subject: {
        $type: 'app.bsky.actor.defs#profileView',
        did: actorDid,
        handle: actor?.handle || actorDid,
        displayName: actor?.displayName || actor?.handle || actorDid,
        ...maybeAvatar(actor?.avatarUrl, actor?.did, req),
        indexedAt: actor?.indexedAt?.toISOString(),
        viewer: {
          muted: false,
          blockedBy: false,
          blocking: undefined,
          following: undefined,
          followedBy: undefined,
        },
      },
      followers: followersList.map((f) => {
        const user = userMap.get(f.followerDid);

        // If user profile not found, create minimal profile with DID
        // This ensures followers always show up even if profile fetch is pending
        if (!user) {
          return {
            $type: 'app.bsky.actor.defs#profileView',
            did: f.followerDid,
            handle: f.followerDid, // Use DID as fallback handle
            displayName: f.followerDid,
            indexedAt: f.indexedAt?.toISOString(),
            viewer: {
              muted: false,
              blockedBy: false,
            },
          };
        }

        const viewerState = viewerDid
          ? relationships.get(f.followerDid)
          : null;
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
        if (viewerState?.followedBy)
          viewer.followedBy = viewerState.followedBy;

        return {
          $type: 'app.bsky.actor.defs#profileView',
          did: user.did,
          handle: user.handle,
          displayName: user.displayName || user.handle,
          ...maybeAvatar(user.avatarUrl, user.did, req),
          indexedAt: user.indexedAt?.toISOString(),
          viewer,
        };
      }),
      cursor: nextCursor,
    });
  } catch (error) {
    handleError(res, error, 'getFollowers');
  }
}
