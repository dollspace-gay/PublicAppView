/**
 * List Service
 * Handles user list queries and list feed operations
 */

import type { Request, Response } from 'express';
import { storage } from '../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { resolveActor } from '../utils/resolvers';
import {
  getListSchema,
  getListsSchema,
  getListFeedSchema,
  getListsWithMembershipSchema,
  getListMutesSchema,
  getListBlocksSchema,
} from '../schemas';
import { xrpcApi } from '../../xrpc-api';

/**
 * Get a specific list by URI
 * GET /xrpc/app.bsky.graph.getList
 */
export async function getList(req: Request, res: Response): Promise<void> {
  try {
    const params = getListSchema.parse(req.query);
    const list = await storage.getList(params.list);
    
    if (!list) {
      res.status(404).json({ 
        error: 'NotFound', 
        message: 'List not found' 
      });
      return;
    }

    res.json({
      list: {
        uri: list.uri,
        cid: list.cid,
        name: list.name,
        purpose: list.purpose,
        createdAt: list.createdAt.toISOString(),
        indexedAt: list.indexedAt.toISOString(),
      },
    });
  } catch (error) {
    handleError(res, error, 'getList');
  }
}

/**
 * Get lists created by an actor
 * GET /xrpc/app.bsky.graph.getLists
 */
export async function getLists(req: Request, res: Response): Promise<void> {
  try {
    const params = getListsSchema.parse(req.query);
    const did = await resolveActor(res, params.actor);
    if (!did) return;

    const lists = await storage.getUserLists(did, params.limit);
    
    res.json({
      lists: lists.map((l) => ({
        uri: l.uri,
        cid: l.cid,
        name: l.name,
        purpose: l.purpose,
        createdAt: l.createdAt.toISOString(),
        indexedAt: l.indexedAt.toISOString(),
      })),
    });
  } catch (error) {
    handleError(res, error, 'getLists');
  }
}

/**
 * Get feed of posts from a list
 * GET /xrpc/app.bsky.feed.getListFeed
 */
export async function getListFeed(req: Request, res: Response): Promise<void> {
  try {
    const params = getListFeedSchema.parse(req.query);
    const posts = await storage.getListFeed(
      params.list,
      params.limit,
      params.cursor
    );

    const viewerDid = await getAuthenticatedDid(req);
    
    // Use legacy API for complex post serialization
    // TODO: Extract serializePosts to utils in future iteration
    const serialized = await (xrpcApi as any).serializePosts(
      posts,
      viewerDid || undefined,
      req
    );

    const oldest = posts.length ? posts[posts.length - 1] : null;
    
    res.json({
      cursor: oldest ? oldest.indexedAt.toISOString() : undefined,
      feed: serialized.map((p: any) => ({ post: p })),
    });
  } catch (error) {
    handleError(res, error, 'getListFeed');
  }
}

/**
 * Get lists with membership information for an actor
 * GET /xrpc/app.bsky.graph.getListsWithMembership
 */
export async function getListsWithMembership(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getListsWithMembershipSchema.parse(req.query);
    const did = await resolveActor(res, params.actor);
    if (!did) return;

    const lists = await storage.getUserLists(did, params.limit);
    
    res.json({
      cursor: undefined,
      lists: lists.map((l) => ({
        uri: l.uri,
        cid: l.cid,
        name: l.name,
        purpose: l.purpose,
      })),
    });
  } catch (error) {
    handleError(res, error, 'getListsWithMembership');
  }
}

/**
 * Get lists that the authenticated user has muted
 * GET /xrpc/app.bsky.graph.getListMutes
 */
export async function getListMutes(req: Request, res: Response): Promise<void> {
  try {
    const params = getListMutesSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const { mutes, cursor } = await storage.getListMutes(
      userDid,
      params.limit,
      params.cursor
    );

    res.json({
      cursor,
      lists: await Promise.all(
        mutes.map(async (listMute) => {
          const list = await storage.getList(listMute.listUri);
          return list
            ? {
                uri: list.uri,
                name: list.name,
                purpose: list.purpose,
              }
            : null;
        })
      ),
    });
  } catch (error) {
    handleError(res, error, 'getListMutes');
  }
}

/**
 * Get lists that the authenticated user has blocked
 * GET /xrpc/app.bsky.graph.getListBlocks
 */
export async function getListBlocks(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const params = getListBlocksSchema.parse(req.query);
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const { blocks, cursor } = await storage.getListBlocks(
      userDid,
      params.limit,
      params.cursor
    );

    res.json({
      cursor,
      lists: await Promise.all(
        blocks.map(async (listBlock) => {
          const list = await storage.getList(listBlock.listUri);
          return list
            ? {
                uri: list.uri,
                name: list.name,
                purpose: list.purpose,
              }
            : null;
        })
      ),
    });
  } catch (error) {
    handleError(res, error, 'getListBlocks');
  }
}
