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

    // Get suggested users with pagination support
    const { users, cursor } = await storage.getSuggestedUsers(
      userDid,
      params.limit,
      params.cursor
    );

    // Convert users to DIDs for profile hydration
    const userDids = users.map((u) => u.did);

    // Use the full _getProfiles helper to build complete profileView objects
    const actors = await (xrpcApi as any)._getProfiles(userDids, req);

    // Build response with optional cursor and recId
    const response: {
      actors: any[];
      cursor?: string;
      recId?: number;
    } = {
      actors,
    };

    if (cursor) {
      response.cursor = cursor;
    }

    // Generate recId for recommendation tracking (snowflake-like ID)
    // Using timestamp + random component for uniqueness
    response.recId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

    res.json(response);
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

    // Check if we have suggestions (not fallback)
    if (suggestions.length === 0) {
      return res.json({
        suggestions: [],
        isFallback: true,
      });
    }

    // Build full profileView objects using _getProfiles helper
    const suggestionDids = suggestions.map((u) => u.did);
    const profiles = await (xrpcApi as any)._getProfiles(suggestionDids, req);

    // Generate recId for recommendation tracking (snowflake-like ID)
    // Using timestamp + random component for uniqueness
    const recId = Date.now() * 1000 + Math.floor(Math.random() * 1000);

    res.json({
      suggestions: profiles,
      isFallback: false,
      recId,
    });
  } catch (error) {
    handleError(res, error, 'getSuggestedFollowsByActor');
  }
}

/**
 * Get suggested users (unspecced)
 * GET /xrpc/app.bsky.unspecced.getSuggestedUsers
 *
 * IMPORTANT: This endpoint is experimental and marked as "unspecced" in the ATProto specification.
 * Returns a list of suggested users with complete profileView objects.
 */
export async function getSuggestedUsersUnspecced(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = suggestedUsersUnspeccedSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    // TODO: Implement category-based filtering when params.category is provided
    // For now, category parameter is accepted but not used
    const { users } = await storage.getSuggestedUsers(userDid, params.limit);

    // Convert users to DIDs for profile hydration
    const userDids = users.map((u) => u.did);

    // Use the full _getProfiles helper to build complete profileView objects
    const actors = await (xrpcApi as any)._getProfiles(userDids, req);

    res.json({ actors });
  } catch (error) {
    handleError(res, error, 'getSuggestedUsersUnspecced');
  }
}
