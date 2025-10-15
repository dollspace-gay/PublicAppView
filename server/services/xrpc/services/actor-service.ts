/**
 * Actor/Profile Service
 * Handles actor profile queries and suggestions
 */

import type { Request, Response } from 'express';
import { storage } from '../../../storage';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import { maybeAvatar } from '../utils/serializers';
import {
  getProfileSchema,
  getProfilesSchema,
  getSuggestionsSchema,
  getSuggestedFollowsByActorSchema,
  suggestedUsersUnspeccedSchema,
} from '../schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get a single actor profile
 * GET /xrpc/app.bsky.actor.getProfile
 */
export async function getProfile(req: Request, res: Response): Promise<void> {
  try {
    const params = getProfileSchema.parse(req.query);
    
    // Use legacy API's _getProfiles helper for complex profile serialization
    const profiles = await (xrpcApi as any)._getProfiles([params.actor], req);
    
    if (profiles.length === 0) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    
    res.json(profiles[0]);
  } catch (error) {
    handleError(res, error, 'getProfile');
  }
}

/**
 * Get multiple actor profiles
 * GET /xrpc/app.bsky.actor.getProfiles
 */
export async function getProfiles(req: Request, res: Response): Promise<void> {
  try {
    // Handle the case where clients send 'actors[]' instead of 'actors'
    if (req.query['actors[]'] && !req.query.actors) {
      req.query.actors = req.query['actors[]'];
    }

    const params = getProfilesSchema.parse(req.query);
    
    // Use legacy API's _getProfiles helper for complex profile serialization
    const profiles = await (xrpcApi as any)._getProfiles(params.actors, req);
    
    res.json({ profiles });
  } catch (error) {
    handleError(res, error, 'getProfiles');
  }
}

/**
 * Get suggested actors to follow
 * GET /xrpc/app.bsky.actor.getSuggestions
 */
export async function getSuggestions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getSuggestionsSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const users = await storage.getSuggestedUsers(userDid, params.limit);

    res.json({
      actors: users.map((user) => ({
        did: user.did,
        handle: user.handle,
        displayName: user.displayName || user.handle,
        ...(user.description && { description: user.description }),
        ...maybeAvatar(user.avatarUrl, user.did, req),
      })),
    });
  } catch (error) {
    handleError(res, error, 'getSuggestions');
  }
}

/**
 * Get suggested follows for a specific actor
 * GET /xrpc/app.bsky.graph.getSuggestedFollowsByActor
 */
export async function getSuggestedFollowsByActor(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getSuggestedFollowsByActorSchema.parse(req.query);
    const actorDid = await resolveActor(res, params.actor);
    if (!actorDid) return;

    const suggestions = await storage.getSuggestedFollowsByActor(
      actorDid,
      params.limit
    );

    res.json({
      suggestions: suggestions.map((user) => ({
        did: user.did,
        handle: user.handle,
        displayName: user.displayName || user.handle,
        ...(user.description && { description: user.description }),
        ...maybeAvatar(user.avatarUrl, user.did, req),
      })),
    });
  } catch (error) {
    handleError(res, error, 'getSuggestedFollowsByActor');
  }
}

/**
 * Get suggested users (unspecced)
 * GET /xrpc/app.bsky.unspecced.getSuggestedUsersUnspecced
 */
export async function getSuggestedUsersUnspecced(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = suggestedUsersUnspeccedSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const users = await storage.getSuggestedUsers(userDid, params.limit);
    
    res.json({
      users: users.map((u) => ({
        did: u.did,
        handle: u.handle,
        displayName: u.displayName,
        ...maybeAvatar(u.avatarUrl, u.did, req),
      })),
    });
  } catch (error) {
    handleError(res, error, 'getSuggestedUsersUnspecced');
  }
}
