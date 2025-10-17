/**
 * Bookmark Service
 *
 * NOTE: Bookmark endpoints are not part of the official ATProto specification.
 * Per ATProto architecture, if/when bookmarks are officially implemented, they will be:
 * - Stored as private records on the PDS (in a "personal" namespace)
 * - Not broadcast to the public firehose
 * - Not accessible to AppView services
 * - Similar to mutes and preferences (private user data)
 *
 * AppView aggregates public data and should not store or serve private user bookmarks.
 * These endpoints return 501 to maintain proper architectural boundaries.
 */

import type { Request, Response } from 'express';
import { requireAuthDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { getUserPdsEndpoint } from '../utils/resolvers';

/**
 * Create a new bookmark
 * POST /xrpc/app.bsky.bookmark.create
 *
 * NOTE: Not part of official ATProto specification. Bookmarks are private user data
 * that should be stored on the PDS, not on AppView. This is similar to mutes and
 * preferences - private metadata that belongs on the user's Personal Data Server.
 */
export async function createBookmark(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Bookmarks are not part of the official ATProto specification and should not be stored on AppView. ' +
               'Per ATProto architecture, bookmarks are private user data that should be stored on the PDS. ' +
               'Unlike likes (which are public records), bookmarks are private metadata similar to mutes. ' +
               (pdsEndpoint
                 ? `If your PDS supports bookmarks, please use: ${pdsEndpoint}/xrpc/app.bsky.bookmark.create`
                 : 'Please check if your PDS supports bookmark functionality.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'createBookmark');
  }
}

/**
 * Delete a bookmark
 * POST /xrpc/app.bsky.bookmark.delete
 *
 * NOTE: Not part of official ATProto specification. Bookmarks are private user data
 * that should be stored on the PDS, not on AppView.
 */
export async function deleteBookmark(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Bookmarks are not part of the official ATProto specification and should not be stored on AppView. ' +
               'Per ATProto architecture, bookmarks are private user data that should be stored on the PDS. ' +
               (pdsEndpoint
                 ? `If your PDS supports bookmarks, please use: ${pdsEndpoint}/xrpc/app.bsky.bookmark.delete`
                 : 'Please check if your PDS supports bookmark functionality.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'deleteBookmark');
  }
}

/**
 * Get user's bookmarks
 * GET /xrpc/app.bsky.bookmark.list
 *
 * NOTE: Not part of official ATProto specification. Bookmarks are private user data
 * that should be stored on the PDS, not on AppView.
 */
export async function getBookmarks(req: Request, res: Response): Promise<void> {
  try {
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;

    const pdsEndpoint = await getUserPdsEndpoint(userDid);

    res.status(501).json({
      error: 'NotImplemented',
      message: 'Bookmarks are not part of the official ATProto specification and should not be stored on AppView. ' +
               'Per ATProto architecture, bookmarks are private user data that should be fetched from the PDS. ' +
               'Unlike public data (posts, likes), bookmarks are private metadata similar to mutes. ' +
               (pdsEndpoint
                 ? `If your PDS supports bookmarks, please use: ${pdsEndpoint}/xrpc/app.bsky.bookmark.list`
                 : 'Please check if your PDS supports bookmark functionality.'),
      pdsEndpoint: pdsEndpoint || undefined,
    });
  } catch (error) {
    handleError(res, error, 'getBookmarks');
  }
}
