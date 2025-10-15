/**
 * Bookmark Service
 * Handles bookmark creation, deletion, and retrieval
 */

import type { Request, Response } from 'express';
import { storage } from '../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { serializePostsEnhanced } from '../utils/serializers';

/**
 * Serialize posts with optional enhanced hydration
 * Uses environment flag to determine which serialization method to use
 */
async function serializePosts(
  posts: unknown[],
  viewerDid?: string,
  req?: Request
): Promise<unknown[]> {
  const useEnhancedHydration =
    process.env.ENHANCED_HYDRATION_ENABLED === 'true';

  if (useEnhancedHydration) {
    return serializePostsEnhanced(posts, viewerDid, req);
  }

  // For now, we'll use enhanced serialization as the default
  // The legacy serialization is complex and will be extracted later
  return serializePostsEnhanced(posts, viewerDid, req);
}

/**
 * Create a new bookmark
 * POST /xrpc/app.bsky.bookmark.create
 */
export async function createBookmark(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const body = req.body as {
      subject?: { uri?: string; cid?: string };
      postUri?: string;
      postCid?: string;
    };
    const postUri: string | undefined = body?.subject?.uri || body?.postUri;
    const postCid: string | undefined = body?.subject?.cid || body?.postCid;

    if (!postUri) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'subject.uri is required',
      });
      return;
    }

    const rkey = `bmk_${Date.now()}`;
    const uri = `at://${userDid}/app.bsky.bookmark.bookmark/${rkey}`;

    // Ensure post exists locally; if not, try to fetch via PDS data fetcher
    const post = await storage.getPost(postUri);
    if (!post) {
      try {
        const { pdsDataFetcher } = await import('../../pds-data-fetcher');
        pdsDataFetcher.markIncomplete('post', userDid, postUri);
      } catch {
        // Ignore errors if pdsDataFetcher is unavailable
      }
    }

    await storage.createBookmark({
      uri,
      userDid,
      postUri,
      createdAt: new Date(),
    });

    res.json({ uri, cid: postCid });
  } catch (error) {
    handleError(res, error, 'createBookmark');
  }
}

/**
 * Delete a bookmark
 * POST /xrpc/app.bsky.bookmark.delete
 */
export async function deleteBookmark(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const body = req.body as { uri?: string };
    const uri: string | undefined = body?.uri;

    if (!uri) {
      res
        .status(400)
        .json({ error: 'InvalidRequest', message: 'uri is required' });
      return;
    }

    await storage.deleteBookmark(uri);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'deleteBookmark');
  }
}

/**
 * Get user's bookmarks
 * GET /xrpc/app.bsky.bookmark.list
 */
export async function getBookmarks(req: Request, res: Response): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const limit = Math.min(100, Number(req.query.limit) || 50);
    const cursor =
      typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const { bookmarks, cursor: nextCursor } = await storage.getBookmarks(
      userDid,
      limit,
      cursor
    );

    const postUris = bookmarks.map((b) => (b as { postUri: string }).postUri);
    const viewerDid = (await getAuthenticatedDid(req)) || undefined;
    const posts = await storage.getPosts(postUris);
    const serialized = await serializePosts(posts, viewerDid, req);
    const byUri = new Map(
      serialized.map((p) => [(p as { uri: string }).uri, p])
    );

    res.json({
      cursor: nextCursor,
      bookmarks: bookmarks
        .map((b) => {
          const bookmark = b as {
            uri: string;
            postUri: string;
            createdAt: Date;
          };
          return {
            uri: bookmark.uri,
            createdAt: bookmark.createdAt.toISOString(),
            post: byUri.get(bookmark.postUri),
          };
        })
        .filter((b) => !!b.post),
    });
  } catch (error) {
    handleError(res, error, 'getBookmarks');
  }
}
