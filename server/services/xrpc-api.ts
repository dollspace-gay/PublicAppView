import type { Request, Response } from "express";
import { storage } from "../storage";
import { authService, validateAndRefreshSession } from "./auth";
import { contentFilter } from "./content-filter";
import { feedAlgorithm } from "./feed-algorithm";
import { feedGeneratorClient } from "./feed-generator-client";
import { pdsClient } from "./pds-client";
import { labelService } from "./label";
import { moderationService } from "./moderation";
import { searchService } from "./search";
import { z } from "zod";
import type { UserSettings } from "@shared/schema";

// Query schemas
const getTimelineSchema = z.object({
  algorithm: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getAuthorFeedSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getPostThreadSchema = z.object({
  uri: z.string(),
  depth: z.coerce.number().min(0).max(10).default(6),
});

const getProfileSchema = z.object({
  actor: z.string(),
});

const getFollowsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(100),
});

const queryLabelsSchema = z.object({
  uriPatterns: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).optional(),
  sources: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).optional(),
  limit: z.coerce.number().min(1).max(250).default(50),
  cursor: z.coerce.number().optional(),
});

const createReportSchema = z.object({
  reasonType: z.string().transform(val => {
    // Strip AT Protocol prefix if present (e.g., "com.atproto.moderation.defs#reasonSpam" -> "spam")
    const match = val.match(/^com\.atproto\.moderation\.defs#reason(.+)$/);
    return match ? match[1].toLowerCase() : val;
  }).pipe(z.enum(["spam", "violation", "misleading", "sexual", "rude", "other"])),
  reason: z.string().optional(),
  subject: z.object({
    $type: z.string(),
    uri: z.string().optional(),
    did: z.string().optional(),
    cid: z.string().optional(),
  }),
});

const searchPostsSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const searchActorsSchema = z.object({
  q: z.string().optional(),
  term: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
}).refine(data => data.q || data.term, {
  message: "Either 'q' or 'term' parameter is required"
});

const searchActorsTypeaheadSchema = z.object({
  q: z.string().optional(),
  term: z.string().optional(),
  limit: z.coerce.number().min(1).max(10).default(10),
}).refine(data => data.q || data.term, {
  message: "Either 'q' or 'term' parameter is required"
});

const listNotificationsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
  seenAt: z.string().optional(),
});

const updateSeenSchema = z.object({
  seenAt: z.string(),
});

const getListSchema = z.object({
  list: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getListsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getListFeedSchema = z.object({
  list: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getPostsSchema = z.object({
  uris: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .pipe(
      z
        .array(z.string())
        .min(1, 'uris parameter cannot be empty')
        .max(25, 'Maximum 25 uris allowed'),
    ),
});

const getLikesSchema = z.object({
  uri: z.string(),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getRepostedBySchema = z.object({
  uri: z.string(),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getQuotesSchema = z.object({
  uri: z.string(),
  cid: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(50),
  cursor: z.string().optional(),
});

const getActorLikesSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getProfilesSchema = z.object({
  actors: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .pipe(
      z
        .array(z.string())
        .min(1, 'actors parameter cannot be empty')
        .max(25, 'Maximum 25 actors allowed'),
    ),
});

const getSuggestionsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getMutesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const muteActorSchema = z.object({
  actor: z.string(),
});

const getBlocksSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getRelationshipsSchema = z.object({
  actor: z.string(),
  others: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).optional(),
});

const getListMutesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getListBlocksSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getKnownFollowersSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getSuggestedFollowsByActorSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(25),
});

const muteActorListSchema = z.object({
  list: z.string(),
});

const unmuteActorListSchema = z.object({
  list: z.string(),
});

const muteThreadSchema = z.object({
  root: z.string(), // URI of the thread root post
});

const getFeedSchema = z.object({
  feed: z.string(), // AT URI of feed generator
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getFeedGeneratorSchema = z.object({
  feed: z.string(),
});

const getFeedGeneratorsSchema = z.object({
  feeds: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ),
});

const getActorFeedsSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const getSuggestedFeedsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const describeFeedGeneratorSchema = z.object({
  // No required params
});

const getStarterPackSchema = z.object({
  starterPack: z.string(),
});

const getStarterPacksSchema = z.object({
  uris: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ),
});

const getLabelerServicesSchema = z.object({
  dids: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ),
  detailed: z.coerce.boolean().default(false).optional(),
});

const registerPushSchema = z.object({
  serviceDid: z.string(),
  token: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  appId: z.string().optional(),
});

const putNotificationPreferencesSchema = z.object({
  priority: z.boolean().optional(),
});

const getJobStatusSchema = z.object({
  jobId: z.string(),
});

const getUploadLimitsSchema = z.object({
  // No required params - authenticated endpoint
});

// Additional schemas for parity with upstream
const getNotificationPreferencesSchema = z.object({});
const listActivitySubscriptionsSchema = z.object({});
const putActivitySubscriptionSchema = z.object({
  subject: z.string().optional(),
  notifications: z.boolean().optional(),
});
const putNotificationPreferencesV2Schema = z.object({
  priority: z.boolean().optional(),
});
const unregisterPushSchema = z.object({
  token: z.string(),
});

// Actor preferences schemas (minimal, accept-through with type routing)
const putActorPreferencesSchema = z.object({
  preferences: z.array(z.any()).default([]),
});

const getActorStarterPacksSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
const getListsWithMembershipSchema = z.object({
  actor: z.string(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
const getStarterPacksWithMembershipSchema = z.object({
  actor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
const searchStarterPacksSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const sendInteractionsSchema = z.object({
  interactions: z
    .array(
      z.object({
        $type: z.string().optional(),
        subject: z.any().optional(),
        event: z.string().optional(),
        createdAt: z.string().optional(),
      }),
    )
    .default([]),
});

// Unspecced compatibility schemas (minimal)
const getPostThreadV2Schema = z.object({
  anchor: z.string(),
  depth: z.coerce.number().min(0).max(50).default(6),
  prioritizeFollowedUsers: z.coerce.boolean().optional(),
  sort: z.string().optional(),
  branchStartDepth: z.coerce.number().optional(),
  branchEndDepth: z.coerce.number().optional(),
});
const getPostThreadOtherV2Schema = z.object({
  anchor: z.string(),
  depth: z.coerce.number().min(0).max(50).default(3),
});
const suggestedUsersUnspeccedSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
const unspeccedNoParamsSchema = z.object({});

export class XRPCApi {
  // Preferences cache: DID -> { preferences: any[], timestamp: number }
  private preferencesCache = new Map<string, { preferences: any[]; timestamp: number }>();
  private readonly PREFERENCES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Clear expired cache entries every minute
    setInterval(() => this.cleanExpiredPreferencesCache(), 60 * 1000);
  }

  /**
   * Check if preferences cache entry is expired
   */
  private isPreferencesCacheExpired(cached: { preferences: any[]; timestamp: number }): boolean {
    return Date.now() - cached.timestamp > this.PREFERENCES_CACHE_TTL;
  }

  /**
   * Clean expired entries from preferences cache
   */
  private cleanExpiredPreferencesCache(): void {
    const now = Date.now();
    const expiredDids: string[] = [];
    
    this.preferencesCache.forEach((cached, did) => {
      if (now - cached.timestamp > this.PREFERENCES_CACHE_TTL) {
        expiredDids.push(did);
      }
    });
    
    expiredDids.forEach(did => {
      this.preferencesCache.delete(did);
    });
  }

  /**
   * Get user session for PDS communication by DID
   */
  private async getUserSessionForDid(userDid: string): Promise<any> {
    // Get all sessions for the user
    const sessions = await storage.getUserSessions(userDid);
    for (const session of sessions) {
      // Validate and refresh session if needed
      const validatedSession = await validateAndRefreshSession(session.id);
      if (validatedSession) {
        return validatedSession;
      }
    }
    return null;
  }

  /**
   * Invalidate preferences cache for a specific user
   */
  public invalidatePreferencesCache(userDid: string): void {
    this.preferencesCache.delete(userDid);
    console.log(`[PREFERENCES] Cache invalidated for ${userDid}`);
  }

  /**
   * Extract authenticated user DID from request
   * Returns null if no valid authentication token is present
   * Supports both local session tokens and AT Protocol access tokens
   */
  private async getAuthenticatedDid(req: Request): Promise<string | null> {
    try {
      const token = authService.extractToken(req);
      if (!token) {
        console.log(`[AUTH] No token found in request to ${req.path}`);
        return null;
      }
      
      const payload = await authService.verifyToken(token);
      if (!payload?.did) {
        console.log(`[AUTH] Token payload missing DID for ${req.path}`);
        return null;
      }
      // Enforce minimal audience/method checks if present
      // Skip for app password tokens (they're pre-validated by PDS)
      try {
        const anyPayload: any = payload;
        const appviewDid = process.env.APPVIEW_DID;
        if (!appviewDid) {
          return res.status(500).json({ error: "APPVIEW_DID not configured" });
        }
        const nsid = req.path.startsWith('/xrpc/') ? req.path.slice('/xrpc/'.length) : undefined;
        
        // Skip aud check for app password tokens (scope=com.atproto.appPassPrivileged)
        const isAppPassword = anyPayload.scope === 'com.atproto.appPassPrivileged';
        if (!isAppPassword && anyPayload.aud) {
          // Accept both base AppView DID and service-specific DID (with #bsky_appview fragment)
          const isBaseAppViewDid = anyPayload.aud === appviewDid;
          const isServiceAppViewDid = anyPayload.aud === `${appviewDid}#bsky_appview`;
          
          if (!isBaseAppViewDid && !isServiceAppViewDid) {
            console.warn(`[AUTH] aud mismatch. expected=${appviewDid} or ${appviewDid}#bsky_appview got=${anyPayload.aud}`);
            return null;
          }
        }
        if (anyPayload.lxm && nsid && anyPayload.lxm !== nsid) {
          console.warn(`[AUTH] lxm mismatch. expected=${nsid} got=${anyPayload.lxm}`);
          return null;
        }
      } catch {}

      return payload.did;
    } catch (error) {
      // Token verification failed (malformed, expired, etc.)
      console.error(`[AUTH] Token verification failed for ${req.path}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Require authentication and return user DID
   * Sends 401 error response if not authenticated
   */
  private async requireAuthDid(req: Request, res: Response): Promise<string | null> {
    const did = await this.getAuthenticatedDid(req);
    if (!did) {
      console.log(`[AUTH] Authentication required but missing for ${req.path}`);
      res.status(401).json({ 
        error: "AuthMissing", 
        message: "Authentication Required" 
      });
      return null;
    }
    return did;
  }

  private _handleError(res: Response, error: unknown, context: string) {
    console.error(`[XRPC] Error in ${context}:`, error);
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ error: 'InvalidRequest', message: error.errors });
    }
    // A simple check for a custom not found error or similar
    if (error instanceof Error && error.message.includes('NotFound')) {
      return res.status(404).json({ error: 'NotFound', message: error.message });
    }
    res
      .status(500)
      .json({ error: 'InternalServerError', message: 'An internal error occurred' });
  }

  private async _resolveActor(
    res: Response,
    actor: string,
  ): Promise<string | null> {
    if (actor.startsWith('did:')) {
      // A small optimization would be to check if the user exists in the DB.
      // But for now, subsequent queries will fail, which is acceptable.
      return actor;
    }
    // TODO: Add caching for handle resolution
    const user = await storage.getUserByHandle(actor.toLowerCase());
    if (!user) {
      res.status(404).json({ error: 'NotFound', message: 'Actor not found' });
      return null;
    }
    return user.did;
  }

  private async serializePosts(posts: any[], viewerDid?: string) {
    if (posts.length === 0) {
      return [];
    }

    const authorDids = Array.from(new Set(posts.map((p) => p.authorDid)));
    const postUris = posts.map((p) => p.uri);

    const [authors, likeUris, repostUris] = await Promise.all([
      storage.getUsers(authorDids),
      viewerDid ? storage.getLikeUris(viewerDid, postUris) : new Map(),
      viewerDid ? storage.getRepostUris(viewerDid, postUris) : new Map(),
    ]);

    const authorsByDid = new Map(authors.map((a) => [a.did, a]));

    // Batch-fetch parent and root posts for reply hydration
    const replyParentUris = new Set<string>();
    const replyRootUris = new Set<string>();
    posts.forEach((post) => {
      if (post.parentUri) {
        replyParentUris.add(post.parentUri);
        replyRootUris.add(post.rootUri || post.parentUri);
      }
    });

    const replyPosts = await storage.getPosts(
      Array.from(replyParentUris).concat(Array.from(replyRootUris)),
    );
    const replyPostsByUri = new Map(replyPosts.map((p) => [p.uri, p]));

    return posts.map((post) => {
      const author = authorsByDid.get(post.authorDid);
      const likeUri = likeUris.get(post.uri);
      const repostUri = repostUris.get(post.uri);

      let reply = undefined;
      if (post.parentUri) {
        const parentPost = replyPostsByUri.get(post.parentUri);
        const rootUri = post.rootUri || post.parentUri;
        const rootPost = replyPostsByUri.get(rootUri);

        if (parentPost && rootPost) {
          reply = {
            root: { uri: rootUri, cid: rootPost.cid },
            parent: { uri: post.parentUri, cid: parentPost.cid },
          };
        }
      }

      const record: any = {
        $type: 'app.bsky.feed.post',
        text: post.text,
        createdAt: post.createdAt.toISOString(),
      };

      if (post.embed) record.embed = post.embed;
      if (post.facets) record.facets = post.facets;
      if (reply) record.reply = reply;

      return {
        uri: post.uri,
        cid: post.cid,
        author: {
          did: post.authorDid,
          handle: author?.handle || post.authorDid,
          displayName: author?.displayName,
          avatar: author?.avatarUrl,
        },
        record,
        embed: post.embed,
        replyCount: post.replyCount || 0,
        repostCount: post.repostCount || 0,
        likeCount: post.likeCount || 0,
        indexedAt: post.indexedAt.toISOString(),
        viewer: viewerDid ? { like: likeUri, repost: repostUri } : {},
      };
    });
  }

  async getTimeline(req: Request, res: Response) {
    try {
      const params = getTimelineSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Debug: Check user's follows and total posts in database
      const followList = await storage.getFollows(userDid);
      const totalPosts = await storage.getStats();
      
      console.log(`[TIMELINE_DEBUG] User ${userDid} has ${followList.length} follows, ${totalPosts.totalPosts} total posts in DB`);

      let posts = await storage.getTimeline(userDid, params.limit, params.cursor);
      
      console.log(`[TIMELINE_DEBUG] Retrieved ${posts.length} posts for timeline`);

      const settings = await storage.getUserSettings(userDid);
      if (settings) {
        posts = contentFilter.filterPosts(posts, settings);
      }

      let algorithmParam = params.algorithm;
      if (!algorithmParam && settings?.feedPreferences) {
        const prefs = settings.feedPreferences as { algorithm?: string };
        algorithmParam = prefs.algorithm;
      }
      const algorithm = feedAlgorithm.parseAlgorithm(algorithmParam);
      const rankedPosts = await feedAlgorithm.applyAlgorithm(posts, algorithm);

      const oldestPost =
        posts.length > 0
          ? posts.reduce((oldest, post) =>
              post.indexedAt < oldest.indexedAt ? post : oldest,
            )
          : null;

      const serializedPosts = await this.serializePosts(rankedPosts, userDid);

      res.json({
        cursor: oldestPost ? oldestPost.indexedAt.toISOString() : undefined,
        feed: serializedPosts.map((post) => ({ post })),
      });
    } catch (error) {
      this._handleError(res, error, 'getTimeline');
    }
  }

  async getAuthorFeed(req: Request, res: Response) {
    try {
      const params = getAuthorFeedSchema.parse(req.query);

      const authorDid = await this._resolveActor(res, params.actor);
      if (!authorDid) return;

      let posts = await storage.getAuthorPosts(
        authorDid,
        params.limit,
        params.cursor,
      );

      const viewerDid = await this.getAuthenticatedDid(req);
      if (viewerDid) {
        const settings = await storage.getUserSettings(viewerDid);
        if (settings) {
          posts = contentFilter.filterPosts(posts, settings);
        }
      }

      const serializedPosts = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );

      res.json({
        cursor:
          posts.length > 0
            ? posts[posts.length - 1].indexedAt.toISOString()
            : undefined,
        feed: serializedPosts.map((post) => ({ post })),
      });
    } catch (error) {
      this._handleError(res, error, 'getAuthorFeed');
    }
  }

  async getPostThread(req: Request, res: Response) {
    try {
      const params = getPostThreadSchema.parse(req.query);

      const allThreadPosts = await storage.getPostThread(params.uri);

      if (allThreadPosts.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const viewerDid = await this.getAuthenticatedDid(req);

      const rootPost = allThreadPosts[0];
      let replies = allThreadPosts.slice(1);

      if (viewerDid) {
        const settings = await storage.getUserSettings(viewerDid);
        if (settings) {
          replies = contentFilter.filterPosts(replies, settings);
        }
      }

      const postsToSerialize = [rootPost, ...replies];
      const serializedPosts = await this.serializePosts(
        postsToSerialize,
        viewerDid || undefined,
      );
      const serializedPostsByUri = new Map(
        serializedPosts.map((p) => [p.uri, p]),
      );

      const threadPost = serializedPostsByUri.get(rootPost.uri);
      if (!threadPost) {
        return res
          .status(500)
          .json({ error: 'Failed to serialize root post of thread' });
      }

      const threadReplies = replies
        .map((reply) => serializedPostsByUri.get(reply.uri))
        .filter(Boolean) as any[];

      const threadView: any = {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: threadPost,
        replies: threadReplies.map((reply) => ({
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: reply,
        })),
      };

      res.json({
        thread: threadView,
      });
    } catch (error) {
      this._handleError(res, error, 'getPostThread');
    }
  }

  async getProfile(req: Request, res: Response) {
    try {
      const params = getProfileSchema.parse(req.query);
      const profiles = await this._getProfiles([params.actor], req);
      if (profiles.length === 0) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      res.json(profiles[0]);
    } catch (error) {
      this._handleError(res, error, 'getProfile');
    }
  }

  async getProfiles(req: Request, res: Response) {
    try {
      // Handle the case where clients send 'actors[]' instead of 'actors'
      if (req.query['actors[]'] && !req.query.actors) {
        req.query.actors = req.query['actors[]'];
      }

      const params = getProfilesSchema.parse(req.query);
      const profiles = await this._getProfiles(params.actors, req);
      res.json({ profiles });
    } catch (error) {
      this._handleError(res, error, 'getProfiles');
    }
  }

  private async _getProfiles(actors: string[], req: Request) {
    const viewerDid = await this.getAuthenticatedDid(req);

    const dids = await Promise.all(
      actors.map(async (actor) => {
        if (actor.startsWith('did:')) {
          return actor;
        }
        // TODO: Add caching for handle resolution
        const user = await storage.getUserByHandle(actor);
        return user?.did;
      }),
    );
    const uniqueDids = Array.from(new Set(dids.filter(Boolean))) as string[];

    if (uniqueDids.length === 0) {
      return [];
    }

    const [
      users,
      followersCounts,
      followingCounts,
      postsCounts,
      listCounts,
      feedgenCounts,
      allLabels,
      relationships,
      mutingLists,
      knownFollowersResults,
    ] = await Promise.all([
      storage.getUsers(uniqueDids),
      storage.getUsersFollowerCounts(uniqueDids),
      storage.getUsersFollowingCounts(uniqueDids),
      storage.getUsersPostCounts(uniqueDids),
      storage.getUsersListCounts(uniqueDids),
      storage.getUsersFeedGeneratorCounts(uniqueDids),
      storage.getLabelsForSubjects(uniqueDids),
      viewerDid
        ? storage.getRelationships(viewerDid, uniqueDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? storage.findMutingListsForUsers(viewerDid, uniqueDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? Promise.all(
            uniqueDids.map((did) =>
              storage.getKnownFollowers(did, viewerDid, 5),
            ),
          )
        : Promise.resolve(
            uniqueDids.map(() => ({ followers: [], count: 0 })),
          ),
    ]);

    const userMap = new Map(users.map((u) => [u.did, u]));
    const labelsBySubject = new Map<string, any[]>();
    allLabels.forEach((label) => {
      if (!labelsBySubject.has(label.subject)) {
        labelsBySubject.set(label.subject, []);
      }
      labelsBySubject.get(label.subject)!.push(label);
    });

    const pinnedPostUris = users
      .map((u) => (u.profileRecord as any)?.pinnedPost?.uri)
      .filter(Boolean);
    const pinnedPosts = await storage.getPosts(pinnedPostUris);
    const pinnedPostCidByUri = new Map<string, string>(
      pinnedPosts.map((p) => [p.uri, p.cid]),
    );

    const profiles = uniqueDids
      .map((did, i) => {
        const user = userMap.get(did);
        if (!user) return null;

        const profileRecord = user.profileRecord as any;
        const pinnedPostUri = profileRecord?.pinnedPost?.uri;
        const pinnedPostCid = pinnedPostUri
          ? pinnedPostCidByUri.get(pinnedPostUri)
          : undefined;

        const viewerState = viewerDid ? relationships.get(did) : null;
        const mutingList = viewerDid ? mutingLists.get(did) : null;
        const knownFollowersResult = viewerDid
          ? knownFollowersResults[i]
          : { followers: [], count: 0 };

        const viewer: any = {
          knownFollowers: {
            count: knownFollowersResult.count,
            followers: knownFollowersResult.followers.map((f) => ({
              did: f.did,
              handle: f.handle,
              displayName: f.displayName,
              avatar: f.avatarUrl,
            })),
          },
        };

        if (viewerState) {
          viewer.muted = !!viewerState.muting || !!mutingList;
          if (mutingList) {
            viewer.mutedByList = {
              $type: 'app.bsky.graph.defs#listViewBasic',
              uri: mutingList.uri,
              name: mutingList.name,
              purpose: mutingList.purpose,
            };
          }
          viewer.blockedBy = viewerState.blockedBy;
          viewer.blocking = viewerState.blocking;
          viewer.following = viewerState.following;
          viewer.followedBy = viewerState.followedBy;
        }

        const profileView: any = {
          $type: 'app.bsky.actor.defs#profileViewDetailed',
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          description: user.description,
          avatar: user.avatarUrl,
          banner: user.bannerUrl,
          followersCount: followersCounts.get(did) || 0,
          followsCount: followingCounts.get(did) || 0,
          postsCount: postsCounts.get(did) || 0,
          indexedAt: user.indexedAt.toISOString(),
          viewer,
          labels: (labelsBySubject.get(did) || []).map((l: any) => ({
            src: l.src,
            uri: l.uri,
            val: l.val,
            neg: l.neg,
            cts: l.createdAt.toISOString(),
          })),
          associated: {
            lists: listCounts.get(did) || 0,
            feedgens: feedgenCounts.get(did) || 0,
          },
        };
        if (pinnedPostUri && pinnedPostCid) {
          profileView.pinnedPost = { uri: pinnedPostUri, cid: pinnedPostCid };
        }
        return profileView;
      })
      .filter(Boolean);

    return profiles;
  }

  async getPreferences(req: Request, res: Response) {
    try {
      // Get authenticated user DID
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Check cache first
      const cached = this.preferencesCache.get(userDid);
      if (cached && !this.isPreferencesCacheExpired(cached)) {
        console.log(`[PREFERENCES] Cache hit for ${userDid}`);
        return res.json({ preferences: cached.preferences });
      }

      // Cache miss - return empty preferences for now
      console.log(`[PREFERENCES] Cache miss for ${userDid}, returning empty preferences`);
      
      // For now, return empty preferences array
      // In a full implementation, this would be stored in the AppView's database
      const emptyPreferences = [];
      
      // Store in cache for future requests
      this.preferencesCache.set(userDid, {
        preferences: emptyPreferences,
        timestamp: Date.now()
      });
      
      console.log(`[PREFERENCES] Cached empty preferences for ${userDid}`);
      return res.json({ preferences: emptyPreferences });
    } catch (error) {
      this._handleError(res, error, 'getPreferences');
    }
  }

  async putPreferences(req: Request, res: Response) {
    try {
      // Get authenticated user DID
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Parse the preferences from request body
      const body = putActorPreferencesSchema.parse(req.body);
      
      // For now, just invalidate the cache and return success
      // In a full implementation, this would store preferences in the AppView's database
      console.log(`[PREFERENCES] Updating preferences for ${userDid}`);
      
      // Invalidate cache after update
      this.invalidatePreferencesCache(userDid);
      
      // Return success response
      return res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'putPreferences');
    }
  }

  async getFollows(req: Request, res: Response) {
    try {
      const params = getFollowsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const follows = await storage.getFollows(actorDid, params.limit);
      const followDids = follows.map((f) => f.followingDid);
      const followUsers = await storage.getUsers(followDids);
      const userMap = new Map(followUsers.map((u) => [u.did, u]));

      const viewerDid = await this.getAuthenticatedDid(req);
      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, followDids)
        : new Map();

      res.json({
        subject: { did: actorDid },
        follows: follows
          .map((f) => {
            const user = userMap.get(f.followingDid);
            if (!user) return null; // Should not happen

            const viewerState = viewerDid
              ? relationships.get(f.followingDid)
              : null;
            const viewer = viewerState
              ? {
                  muted: !!viewerState.muting,
                  blockedBy: viewerState.blockedBy,
                  blocking: viewerState.blocking,
                  following: viewerState.following,
                  followedBy: viewerState.followedBy,
                }
              : {};

            return {
              $type: 'app.bsky.actor.defs#profileView',
              did: user.did,
              handle: user.handle,
              displayName: user.displayName,
              avatar: user.avatarUrl,
              indexedAt: user.indexedAt.toISOString(),
              viewer: viewer,
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getFollows');
    }
  }

  async getFollowers(req: Request, res: Response) {
    try {
      const params = getFollowsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const followers = await storage.getFollowers(actorDid, params.limit);
      const followerDids = followers.map((f) => f.followerDid);
      const followerUsers = await storage.getUsers(followerDids);
      const userMap = new Map(followerUsers.map((u) => [u.did, u]));

      const viewerDid = await this.getAuthenticatedDid(req);
      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, followerDids)
        : new Map();

      res.json({
        subject: { did: actorDid },
        followers: followers
          .map((f) => {
            const user = userMap.get(f.followerDid);
            if (!user) return null;

            const viewerState = viewerDid
              ? relationships.get(f.followerDid)
              : null;
            const viewer = viewerState
              ? {
                  muted: !!viewerState.muting,
                  blockedBy: viewerState.blockedBy,
                  blocking: viewerState.blocking,
                  following: viewerState.following,
                  followedBy: viewerState.followedBy,
                }
              : {};

            return {
              $type: 'app.bsky.actor.defs#profileView',
              did: user.did,
              handle: user.handle,
              displayName: user.displayName,
              avatar: user.avatarUrl,
              indexedAt: user.indexedAt.toISOString(),
              viewer: viewer,
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getFollowers');
    }
  }

  async getSuggestions(req: Request, res: Response) {
    try {
      const params = getSuggestionsSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const users = await storage.getSuggestedUsers(userDid, params.limit);

      res.json({
        actors: users.map((user) => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          description: user.description,
          avatar: user.avatarUrl,
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getSuggestions');
    }
  }

  async getBlocks(req: Request, res: Response) {
    try {
      const params = getBlocksSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { blocks, cursor } = await storage.getBlocks(
        userDid,
        params.limit,
        params.cursor,
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
              displayName: user.displayName,
              avatar: user.avatarUrl,
              viewer: {
                blocking: b.uri,
                muted: false, // You can't block someone you don't mute
              },
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getBlocks');
    }
  }

  async getMutes(req: Request, res: Response) {
    try {
      const params = getMutesSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { mutes, cursor } = await storage.getMutes(
        userDid,
        params.limit,
        params.cursor,
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
              displayName: user.displayName,
              avatar: user.avatarUrl,
              viewer: {
                muted: true,
              },
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getMutes');
    }
  }

  async muteActor(req: Request, res: Response) {
    try {
      const params = muteActorSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const mutedDid = await this._resolveActor(res, params.actor);
      if (!mutedDid) return;

      await storage.createMute({
        uri: `at://${userDid}/app.bsky.graph.mute/${Date.now()}`,
        muterDid: userDid,
        mutedDid,
        createdAt: new Date(),
      });

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'muteActor');
    }
  }

  async unmuteActor(req: Request, res: Response) {
    try {
      const params = muteActorSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const mutedDid = await this._resolveActor(res, params.actor);
      if (!mutedDid) return;

      const { mutes } = await storage.getMutes(userDid, 1000);
      const mute = mutes.find((m) => m.mutedDid === mutedDid);

      if (mute) {
        await storage.deleteMute(mute.uri);
      }

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unmuteActor');
    }
  }

  async getRelationships(req: Request, res: Response) {
    try {
      const params = getRelationshipsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const targetDids = params.others || [];
      const relationships = await storage.getRelationships(actorDid, targetDids);

      res.json({
        actor: params.actor,
        relationships: Array.from(relationships.entries()).map(([did, rel]) => ({
          did,
          following: rel.following
            ? `at://${actorDid}/app.bsky.graph.follow/${did}`
            : undefined,
          followedBy: rel.followedBy
            ? `at://${did}/app.bsky.graph.follow/${actorDid}`
            : undefined,
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getRelationships');
    }
  }

  async getListMutes(req: Request, res: Response) {
    try {
      const params = getListMutesSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { mutes, cursor } = await storage.getListMutes(
        userDid,
        params.limit,
        params.cursor,
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
          }),
        ),
      });
    } catch (error) {
      this._handleError(res, error, 'getListMutes');
    }
  }

  async getListBlocks(req: Request, res: Response) {
    try {
      const params = getListBlocksSchema.parse(req.query);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { blocks, cursor } = await storage.getListBlocks(
        userDid,
        params.limit,
        params.cursor,
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
          }),
        ),
      });
    } catch (error) {
      this._handleError(res, error, 'getListBlocks');
    }
  }

  async getKnownFollowers(req: Request, res: Response) {
    try {
      const params = getKnownFollowersSchema.parse(req.query);

      const viewerDid = await this.requireAuthDid(req, res);
      if (!viewerDid) return;

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const { followers, cursor } = await storage.getKnownFollowers(
        actorDid,
        viewerDid,
        params.limit,
        params.cursor,
      );

      res.json({
        subject: params.actor,
        cursor,
        followers: followers.map((user) => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          avatar: user.avatarUrl,
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getKnownFollowers');
    }
  }

  async getSuggestedFollowsByActor(req: Request, res: Response) {
    try {
      const params = getSuggestedFollowsByActorSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const suggestions = await storage.getSuggestedFollowsByActor(
        actorDid,
        params.limit,
      );

      res.json({
        suggestions: suggestions.map((user) => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          description: user.description,
          avatar: user.avatarUrl,
        })),
      });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedFollowsByActor');
    }
  }

  async muteActorList(req: Request, res: Response) {
    try {
      const params = muteActorListSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Verify list exists
      const list = await storage.getList(params.list);
      if (!list) {
        return res.status(404).json({ error: 'List not found' });
      }

      await storage.createListMute({
        uri: `at://${userDid}/app.bsky.graph.listMute/${Date.now()}`,
        muterDid: userDid,
        listUri: params.list,
        createdAt: new Date(),
      });

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'muteActorList');
    }
  }

  async unmuteActorList(req: Request, res: Response) {
    try {
      const params = unmuteActorListSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const { mutes } = await storage.getListMutes(userDid, 1000);
      const mute = mutes.find((m) => m.listUri === params.list);

      if (mute) {
        await storage.deleteListMute(mute.uri);
      }

      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unmuteActorList');
    }
  }

  // app.bsky.graph.muteThread
  async muteThread(req: Request, res: Response) {
    try {
      const params = muteThreadSchema.parse(req.body);

      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Verify thread root post exists
      const rootPost = await storage.getPost(params.root);
      if (!rootPost) {
        return res.status(404).json({ error: 'Thread root post not found' });
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
      this._handleError(res, error, 'muteThread');
    }
  }

  // Feed Generator endpoints

  // app.bsky.feed.getFeed
  async getFeed(req: Request, res: Response) {
    try {
      const params = getFeedSchema.parse(req.query);

      // Get feed generator info
      const feedGen = await storage.getFeedGenerator(params.feed);
      if (!feedGen) {
        return res.status(404).json({ error: 'Feed generator not found' });
      }

      console.log(
        `[XRPC] Getting feed from generator: ${feedGen.displayName} (${feedGen.did})`,
      );

      // Call external feed generator service to get skeleton
      // Then hydrate with full post data from our database
      const { feed: hydratedFeed, cursor } = await feedGeneratorClient.getFeed(
        feedGen.did,
        {
          feed: params.feed,
          limit: params.limit,
          cursor: params.cursor,
        },
        {
          viewerAuthorization: req.headers['authorization'] as string | undefined,
        },
      );

      console.log(
        `[XRPC] Hydrated ${hydratedFeed.length} posts from feed generator`,
      );

      // Build post views with author information
      const feed = await Promise.all(
        hydratedFeed.map(async ({ post, reason }) => {
          const author = await storage.getUser(post.authorDid);

          const postView: any = {
            uri: post.uri,
            cid: post.cid,
            author: {
              did: post.authorDid,
              handle: author?.handle || 'unknown.user',
              displayName: author?.displayName,
              avatar: author?.avatarUrl,
            },
            record: {
              text: post.text,
              createdAt: post.createdAt.toISOString(),
            },
            replyCount: 0,
            repostCount: 0,
            likeCount: 0,
            indexedAt: post.indexedAt.toISOString(),
          };

          const feedView: any = { post: postView };

          // Include reason if present (e.g., repost context)
          if (reason) {
            feedView.reason = reason;
          }

          return feedView;
        }),
      );

      res.json({ feed, cursor });
    } catch (error) {
      // If feed generator is unavailable, provide a helpful error
      if (
        error instanceof Error &&
        error.message.includes('Could not resolve')
      ) {
        return res.status(502).json({
          error: 'Feed generator service unavailable',
          message: 'The feed generator service endpoint could not be reached',
        });
      }
      this._handleError(res, error, 'getFeed');
    }
  }

  async getFeedGenerator(req: Request, res: Response) {
    try {
      const params = getFeedGeneratorSchema.parse(req.query);

      const generator = await storage.getFeedGenerator(params.feed);
      if (!generator) {
        return res.status(404).json({ error: 'Feed generator not found' });
      }

      const creator = await storage.getUser(generator.creatorDid);

      const creatorView: any = {
        did: generator.creatorDid,
        handle:
          creator?.handle ||
          `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
      };
      if (creator?.displayName) creatorView.displayName = creator.displayName;
      if (creator?.avatarUrl) creatorView.avatar = creator.avatarUrl;

      const view: any = {
        uri: generator.uri,
        cid: generator.cid,
        did: generator.did,
        creator: creatorView,
        displayName: generator.displayName,
        likeCount: generator.likeCount,
        indexedAt: generator.indexedAt.toISOString(),
      };
      if (generator.description) view.description = generator.description;
      if (generator.avatarUrl) view.avatar = generator.avatarUrl;

      res.json({
        view,
        isOnline: true,
        isValid: true,
      });
    } catch (error) {
      this._handleError(res, error, 'getFeedGenerator');
    }
  }

  async getFeedGenerators(req: Request, res: Response) {
    try {
      const params = getFeedGeneratorsSchema.parse(req.query);

      const generators = await storage.getFeedGenerators(params.feeds);

      const views = await Promise.all(
        generators.map(async (generator) => {
          const creator = await storage.getUser(generator.creatorDid);

          const creatorView: any = {
            did: generator.creatorDid,
            handle:
              creator?.handle ||
              `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = creator.avatarUrl;

          const view: any = {
            uri: generator.uri,
            cid: generator.cid,
            did: generator.did,
            creator: creatorView,
            displayName: generator.displayName,
            likeCount: generator.likeCount,
            indexedAt: generator.indexedAt.toISOString(),
          };
          if (generator.description) view.description = generator.description;
          if (generator.avatarUrl) view.avatar = generator.avatarUrl;

          return view;
        }),
      );

      res.json({ feeds: views });
    } catch (error) {
      this._handleError(res, error, 'getFeedGenerators');
    }
  }

  async getActorFeeds(req: Request, res: Response) {
    try {
      const params = getActorFeedsSchema.parse(req.query);

      const actorDid = await this._resolveActor(res, params.actor);
      if (!actorDid) return;

      const { generators, cursor } = await storage.getActorFeeds(
        actorDid,
        params.limit,
        params.cursor,
      );

      const feeds = await Promise.all(
        generators.map(async (generator) => {
          const creator = await storage.getUser(generator.creatorDid);

          const creatorView: any = {
            did: generator.creatorDid,
            handle:
              creator?.handle ||
              `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = creator.avatarUrl;

          const view: any = {
            uri: generator.uri,
            cid: generator.cid,
            did: generator.did,
            creator: creatorView,
            displayName: generator.displayName,
            likeCount: generator.likeCount,
            indexedAt: generator.indexedAt.toISOString(),
          };
          if (generator.description) view.description = generator.description;
          if (generator.avatarUrl) view.avatar = generator.avatarUrl;

          return view;
        }),
      );

      res.json({ cursor, feeds });
    } catch (error) {
      this._handleError(res, error, 'getActorFeeds');
    }
  }

  async getSuggestedFeeds(req: Request, res: Response) {
    try {
      const params = getSuggestedFeedsSchema.parse(req.query);

      const { generators, cursor } = await storage.getSuggestedFeeds(
        params.limit,
        params.cursor,
      );

      const feeds = await Promise.all(
        generators.map(async (generator) => {
          const creator = await storage.getUser(generator.creatorDid);

          const creatorView: any = {
            did: generator.creatorDid,
            handle:
              creator?.handle ||
              `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = creator.avatarUrl;

          const view: any = {
            uri: generator.uri,
            cid: generator.cid,
            did: generator.did,
            creator: creatorView,
            displayName: generator.displayName,
            likeCount: generator.likeCount,
            indexedAt: generator.indexedAt.toISOString(),
          };
          if (generator.description) view.description = generator.description;
          if (generator.avatarUrl) view.avatar = generator.avatarUrl;

          return view;
        }),
      );

      res.json({ cursor, feeds });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedFeeds');
    }
  }

  async describeFeedGenerator(req: Request, res: Response) {
    try {
      describeFeedGeneratorSchema.parse(req.query);

      const appviewDid = process.env.APPVIEW_DID;
      if (!appviewDid) {
        return res.status(500).json({ error: "APPVIEW_DID not configured" });
      }
      
      res.json({
        did: appviewDid,
        feeds: [
          {
            uri: `at://${appviewDid}/app.bsky.feed.generator/reverse-chron`,
          },
        ],
      });
    } catch (error) {
      this._handleError(res, error, 'describeFeedGenerator');
    }
  }

  // Starter Pack endpoints
  async getStarterPack(req: Request, res: Response) {
    try {
      const params = getStarterPackSchema.parse(req.query);

      const pack = await storage.getStarterPack(params.starterPack);
      if (!pack) {
        return res.status(404).json({ error: 'Starter pack not found' });
      }

      const creator = await storage.getUser(pack.creatorDid);
      let list = null;
      if (pack.listUri) {
        list = await storage.getList(pack.listUri);
      }

      const creatorView: any = {
        did: pack.creatorDid,
        handle:
          creator?.handle || `${pack.creatorDid.replace(/:/g, '-')}.invalid`,
      };
      if (creator?.displayName) creatorView.displayName = creator.displayName;
      if (creator?.avatarUrl) creatorView.avatar = creator.avatarUrl;

      const record: any = {
        name: pack.name,
        list: pack.listUri,
        feeds: pack.feeds,
        createdAt: pack.createdAt.toISOString(),
      };
      if (pack.description) record.description = pack.description;

      const starterPackView: any = {
        uri: pack.uri,
        cid: pack.cid,
        record,
        creator: creatorView,
        indexedAt: pack.indexedAt.toISOString(),
      };

      if (list) {
        starterPackView.list = {
          uri: list.uri,
          cid: list.cid,
          name: list.name,
          purpose: list.purpose,
        };
      }

      res.json({ starterPack: starterPackView });
    } catch (error) {
      this._handleError(res, error, 'getStarterPack');
    }
  }

  async getStarterPacks(req: Request, res: Response) {
    try {
      const params = getStarterPacksSchema.parse(req.query);

      const packs = await storage.getStarterPacks(params.uris);

      const views = await Promise.all(
        packs.map(async (pack) => {
          const creator = await storage.getUser(pack.creatorDid);
          let list = null;
          if (pack.listUri) {
            list = await storage.getList(pack.listUri);
          }

          const creatorView: any = {
            did: pack.creatorDid,
            handle: creator?.handle || `handle.invalid`,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = creator.avatarUrl;

          const record: any = {
            name: pack.name,
            list: pack.listUri,
            feeds: pack.feeds,
            createdAt: pack.createdAt.toISOString(),
          };
          if (pack.description) record.description = pack.description;

          const view: any = {
            uri: pack.uri,
            cid: pack.cid,
            record,
            creator: creatorView,
            indexedAt: pack.indexedAt.toISOString(),
          };

          if (list) {
            view.list = {
              uri: list.uri,
              cid: list.cid,
              name: list.name,
              purpose: list.purpose,
            };
          }

          return view;
        }),
      );

      res.json({ starterPacks: views });
    } catch (error) {
      this._handleError(res, error, 'getStarterPacks');
    }
  }

  async getServices(req: Request, res: Response) {
    try {
      const params = getLabelerServicesSchema.parse(req.query);

      // Get all labeler services for the requested DIDs
      const allServices = await Promise.all(
        params.dids.map(async (did: string) => {
          const services = await storage.getLabelerServicesByCreator(did);
          return services;
        }),
      );

      // Flatten array of arrays
      const services = allServices.flat();

      const views = await Promise.all(
        services.map(async (service) => {
          const creator = await storage.getUser(service.creatorDid);

          const creatorView: any = {
            did: service.creatorDid,
            handle:
              creator?.handle ||
              `${service.creatorDid.replace(/:/g, '-')}.invalid`,
          };
          if (creator?.displayName)
            creatorView.displayName = creator.displayName;
          if (creator?.avatarUrl) creatorView.avatar = creator.avatarUrl;

          const view: any = {
            uri: service.uri,
            cid: service.cid,
            creator: creatorView,
            likeCount: service.likeCount,
            indexedAt: service.indexedAt.toISOString(),
          };

          // Add policies
          if (service.policies) {
            view.policies = service.policies;
          }

          // Get labels applied to this labeler service
          const labels = await storage.getLabelsForSubject(service.uri);
          if (labels.length > 0) {
            view.labels = labels.map((label) => {
              const labelView: any = {
                src: label.src,
                uri: label.subject,
                val: label.val,
                cts: label.createdAt.toISOString(),
              };
              if (label.neg) labelView.neg = true;
              return labelView;
            });
          }

          return view;
        }),
      );

      res.json({ views });
    } catch (error) {
      this._handleError(res, error, 'getServices');
    }
  }

  // app.bsky.notification.registerPush
  async registerPush(req: Request, res: Response) {
    try {
      const params = registerPushSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Create or update push subscription
      const subscription = await storage.createPushSubscription({
        userDid,
        platform: params.platform,
        token: params.token,
        appId: params.appId,
      });

      res.json({
        id: subscription.id,
        platform: subscription.platform,
        createdAt: subscription.createdAt.toISOString(),
      });
    } catch (error) {
      this._handleError(res, error, 'registerPush');
    }
  }

  // app.bsky.notification.putPreferences
  async putNotificationPreferences(req: Request, res: Response) {
    try {
      const params = putNotificationPreferencesSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      // Get existing preferences or create new ones if they don't exist
      let prefs = await storage.getUserPreferences(userDid);
      if (!prefs) {
        prefs = await storage.createUserPreferences({
          userDid,
          notificationPriority:
            params.priority !== undefined ? params.priority : false,
        });
      } else {
        // Update notification preferences
        prefs = await storage.updateUserPreferences(userDid, {
          notificationPriority:
            params.priority !== undefined
              ? params.priority
              : prefs.notificationPriority,
        });
      }

      res.json({
        priority: prefs?.notificationPriority ?? false,
      });
    } catch (error) {
      this._handleError(res, error, 'putNotificationPreferences');
    }
  }

  // app.bsky.video.getJobStatus
  async getJobStatus(req: Request, res: Response) {
    try {
      const params = getJobStatusSchema.parse(req.query);

      // Get video job
      const job = await storage.getVideoJob(params.jobId);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      // Build response
      const response: any = {
        jobId: job.jobId,
        did: job.userDid,
        state: job.state,
        progress: job.progress,
      };

      // Add optional fields
      if (job.blobRef) {
        response.blob = job.blobRef;
      }

      if (job.error) {
        response.error = job.error;
      }

      res.json({ jobStatus: response });
    } catch (error) {
      this._handleError(res, error, 'getJobStatus');
    }
  }

  // app.bsky.video.getUploadLimits
  async getUploadLimits(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const DAILY_VIDEO_LIMIT = Number(process.env.VIDEO_DAILY_LIMIT || 10);
      const DAILY_BYTES_LIMIT = Number(process.env.VIDEO_DAILY_BYTES || 100 * 1024 * 1024);
      const todayJobs = await storage.getUserVideoJobs(userDid, 1000);
      const today = new Date(); today.setHours(0,0,0,0);
      const usedVideos = todayJobs.filter(j => j.createdAt >= today).length;
      const canUpload = usedVideos < DAILY_VIDEO_LIMIT;
      res.json({
        canUpload,
        remainingDailyVideos: Math.max(0, DAILY_VIDEO_LIMIT - usedVideos),
        remainingDailyBytes: DAILY_BYTES_LIMIT, // Without blob accounting, expose cap
        message: canUpload ? undefined : 'Daily upload limit reached',
        error: undefined,
      });
    } catch (error) {
      this._handleError(res, error, 'getUploadLimits');
    }
  }

  // Notification parity endpoints
  async getNotificationPreferences(req: Request, res: Response) {
    try {
      getNotificationPreferencesSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const prefs = await storage.getUserPreferences(userDid);
      res.json({ preferences: [{ $type: 'app.bsky.notification.defs#preferences', priority: !!prefs?.notificationPriority }] });
    } catch (error) {
      this._handleError(res, error, 'getNotificationPreferences');
    }
  }

  async listActivitySubscriptions(req: Request, res: Response) {
    try {
      listActivitySubscriptionsSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const subs = await storage.getUserPushSubscriptions(userDid);
      res.json({ subscriptions: subs.map(s => ({
        id: s.id,
        platform: s.platform,
        appId: s.appId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })) });
    } catch (error) {
      this._handleError(res, error, 'listActivitySubscriptions');
    }
  }

  async putActivitySubscription(req: Request, res: Response) {
    try {
      const body = putActivitySubscriptionSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      // Upsert a synthetic web subscription for parity
      await storage.createPushSubscription({
        userDid,
        platform: 'web',
        token: `activity-${userDid}`,
        endpoint: undefined,
        keys: undefined,
        appId: body.subject || undefined,
      } as any);
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'putActivitySubscription');
    }
  }

  async putNotificationPreferencesV2(req: Request, res: Response) {
    try {
      const params = putNotificationPreferencesV2Schema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      let prefs = await storage.getUserPreferences(userDid);
      if (!prefs) {
        prefs = await storage.createUserPreferences({
          userDid,
          notificationPriority: !!params.priority,
        } as any);
      } else {
        prefs = await storage.updateUserPreferences(userDid, {
          notificationPriority: params.priority ?? prefs.notificationPriority,
        });
      }
      res.json({ preferences: [{ $type: 'app.bsky.notification.defs#preferences', priority: !!prefs?.notificationPriority }] });
    } catch (error) {
      this._handleError(res, error, 'putNotificationPreferencesV2');
    }
  }

  async unregisterPush(req: Request, res: Response) {
    try {
      const params = unregisterPushSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      await storage.deletePushSubscriptionByToken(params.token);
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unregisterPush');
    }
  }

  // Feed interactions parity
  async sendInteractions(req: Request, res: Response) {
    try {
      const body = sendInteractionsSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      // Record basic metrics; future: persist interactions for ranking signals
      const { metricsService } = await import('./metrics');
      for (const _ of body.interactions) {
        metricsService.recordApiRequest();
      }
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'sendInteractions');
    }
  }

  // Graph parity endpoints
  async getActorStarterPacks(req: Request, res: Response) {
    try {
      const params = getActorStarterPacksSchema.parse(req.query);
      const did = await this._resolveActor(res, params.actor);
      if (!did) return;
      const { starterPacks, cursor } = await storage.getStarterPacksByCreator(did, params.limit, params.cursor);
      res.json({ cursor, starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid, record: { name: p.name, list: p.listUri, feeds: p.feeds, createdAt: p.createdAt.toISOString() } })), feeds: [] });
    } catch (error) {
      this._handleError(res, error, 'getActorStarterPacks');
    }
  }

  async getListsWithMembership(req: Request, res: Response) {
    try {
      const params = getListsWithMembershipSchema.parse(req.query);
      const did = await this._resolveActor(res, params.actor);
      if (!did) return;
      const lists = await storage.getUserLists(did, params.limit);
      res.json({ cursor: undefined, lists: lists.map((l) => ({ uri: l.uri, cid: l.cid, name: l.name, purpose: l.purpose })) });
    } catch (error) {
      this._handleError(res, error, 'getListsWithMembership');
    }
  }

  async getStarterPacksWithMembership(req: Request, res: Response) {
    try {
      const params = getStarterPacksWithMembershipSchema.parse(req.query);
      const did = params.actor ? await this._resolveActor(res, params.actor) : null;
      const { starterPacks, cursor } = did ? await storage.getStarterPacksByCreator(did, params.limit, params.cursor) : await storage.listStarterPacks(params.limit, params.cursor);
      res.json({ cursor, starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid })) });
    } catch (error) {
      this._handleError(res, error, 'getStarterPacksWithMembership');
    }
  }

  async searchStarterPacks(req: Request, res: Response) {
    try {
      const params = searchStarterPacksSchema.parse(req.query);
      const { starterPacks, cursor } = await storage.searchStarterPacksByName(params.q, params.limit, params.cursor);
      res.json({ cursor, starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid })) });
    } catch (error) {
      this._handleError(res, error, 'searchStarterPacks');
    }
  }

  async unmuteThread(req: Request, res: Response) {
    try {
      const body = muteThreadSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const { mutes } = await storage.getThreadMutes(userDid, 1000);
      const existing = mutes.find((m) => m.threadRootUri === body.root);
      if (existing) {
        await storage.deleteThreadMute(existing.uri);
      }
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'unmuteThread');
    }
  }

  // Bookmark endpoints – minimal stubs
  async createBookmark(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const body = req.body as any;
      const postUri: string | undefined = body?.subject?.uri || body?.postUri;
      const postCid: string | undefined = body?.subject?.cid || body?.postCid;
      if (!postUri) {
        return res.status(400).json({ error: 'InvalidRequest', message: 'subject.uri is required' });
      }

      const rkey = `bmk_${Date.now()}`;
      const uri = `at://${userDid}/app.bsky.bookmark.bookmark/${rkey}`;

      // Ensure post exists locally; if not, try to fetch via PDS data fetcher
      const post = await storage.getPost(postUri);
      if (!post) {
        try {
          const { pdsDataFetcher } = await import('../services/pds-data-fetcher');
          pdsDataFetcher.markIncomplete('post', userDid, postUri);
        } catch {}
      }
      await storage.createBookmark({ uri, userDid, postUri, createdAt: new Date() });

      res.json({ uri, cid: postCid });
    } catch (error) {
      this._handleError(res, error, 'createBookmark');
    }
  }

  async deleteBookmark(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const body = req.body as any;
      const uri: string | undefined = body?.uri;
      if (!uri) {
        return res.status(400).json({ error: 'InvalidRequest', message: 'uri is required' });
      }
      await storage.deleteBookmark(uri);
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'deleteBookmark');
    }
  }

  async getBookmarks(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const limit = Math.min(100, Number(req.query.limit) || 50);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const { bookmarks, cursor: nextCursor } = await storage.getBookmarks(userDid, limit, cursor);
      const postUris = bookmarks.map(b => b.postUri);
      const viewerDid = await this.getAuthenticatedDid(req) || undefined;
      const posts = await storage.getPosts(postUris);
      const serialized = await this.serializePosts(posts, viewerDid);
      const byUri = new Map(serialized.map(p => [p.uri, p]));
      res.json({
        cursor: nextCursor,
        bookmarks: bookmarks.map(b => ({
          uri: b.uri,
          createdAt: b.createdAt.toISOString(),
          post: byUri.get(b.postUri),
        })).filter(b => !!b.post),
      });
    } catch (error) {
      this._handleError(res, error, 'getBookmarks');
    }
  }

  // Unspecced minimal responses
  async getPostThreadV2(req: Request, res: Response) {
    try {
      const params = getPostThreadV2Schema.parse(req.query);
      const posts = await storage.getPostThread(params.anchor);
      const viewerDid = await this.getAuthenticatedDid(req);
      const serialized = await this.serializePosts(posts, viewerDid || undefined);
      res.json({ hasOtherReplies: false, thread: serialized.length ? { $type: 'app.bsky.unspecced.defs#threadItemPost', post: serialized[0] } : null, threadgate: null });
    } catch (error) {
      this._handleError(res, error, 'getPostThreadV2');
    }
  }

  async getPostThreadOtherV2(req: Request, res: Response) {
    try {
      const _ = getPostThreadOtherV2Schema.parse(req.query);
      res.json({ hasOtherReplies: false, items: [] });
    } catch (error) {
      this._handleError(res, error, 'getPostThreadOtherV2');
    }
  }

  async getSuggestedUsersUnspecced(req: Request, res: Response) {
    try {
      const params = suggestedUsersUnspeccedSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const users = await storage.getSuggestedUsers(userDid, params.limit);
      res.json({ users: users.map((u) => ({ did: u.did, handle: u.handle, displayName: u.displayName, avatar: u.avatarUrl })) });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedUsersUnspecced');
    }
  }

  async getSuggestedFeedsUnspecced(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      const { generators } = await storage.getSuggestedFeeds(10);
      res.json({ feeds: generators.map((g) => g.uri) });
    } catch (error) {
      this._handleError(res, error, 'getSuggestedFeedsUnspecced');
    }
  }

  async getOnboardingSuggestedStarterPacks(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      // Return recent starter packs as onboarding suggestions
      const { starterPacks } = await storage.listStarterPacks(10);
      res.json({ starterPacks: starterPacks.map(p => ({ uri: p.uri, cid: p.cid, createdAt: p.createdAt.toISOString() })) });
    } catch (error) {
      this._handleError(res, error, 'getOnboardingSuggestedStarterPacks');
    }
  }

  async getTaggedSuggestions(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      // Return recent users as generic suggestions
      const users = await storage.getSuggestedUsers(undefined, 25);
      res.json({ suggestions: users.map(u => ({ did: u.did, handle: u.handle, displayName: u.displayName, avatar: u.avatarUrl })) });
    } catch (error) {
      this._handleError(res, error, 'getTaggedSuggestions');
    }
  }

  async getTrendingTopics(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      // Placeholder: compute trending by most reposted authors' handles
      const stats = await storage.getStats();
      res.json({ topics: stats.totalPosts > 0 ? ["#bluesky", "#atproto"] : [] });
    } catch (error) {
      this._handleError(res, error, 'getTrendingTopics');
    }
  }

  async getTrends(req: Request, res: Response) {
    try {
      const _ = unspeccedNoParamsSchema.parse(req.query);
      res.json({ trends: [{ topic: "#bluesky", count: 0 }] });
    } catch (error) {
      this._handleError(res, error, 'getTrends');
    }
  }

  async getUnspeccedConfig(req: Request, res: Response) {
    try {
      res.json({ liveNowConfig: { enabled: false } });
    } catch (error) {
      this._handleError(res, error, 'getUnspeccedConfig');
    }
  }

  async getAgeAssuranceState(req: Request, res: Response) {
    try {
      res.json({ state: 'unknown' });
    } catch (error) {
      this._handleError(res, error, 'getAgeAssuranceState');
    }
  }

  async initAgeAssurance(req: Request, res: Response) {
    try {
      res.json({ ok: true });
    } catch (error) {
      this._handleError(res, error, 'initAgeAssurance');
    }
  }

  // Previously stubbed endpoints completed for parity
  async queryLabels(req: Request, res: Response) {
    try {
      const params = queryLabelsSchema.parse(req.query);
      const subjects = params.uriPatterns ?? [];
      if (subjects.some((u) => u.includes('*'))) {
        return res
          .status(400)
          .json({ error: 'InvalidRequest', message: 'wildcards not supported' });
      }
      const sources = params.sources ?? [];
      if (sources.length === 0) {
        return res
          .status(400)
          .json({ error: 'InvalidRequest', message: 'source dids are required' });
      }
      const labels = await storage.getLabelsForSubjects(subjects);
      const filtered = labels.filter((l) => sources.includes(l.src));
      res.json({ cursor: undefined, labels: filtered });
    } catch (error) {
      this._handleError(res, error, 'queryLabels');
    }
  }
  async createReport(req: Request, res: Response) {
    try {
      const params = createReportSchema.parse(req.body);
      const reporterDid = (await this.getAuthenticatedDid(req)) ||
        (req as any).user?.did ||
        'did:unknown:anonymous';
      const report = await storage.createModerationReport({
        reporterDid,
        reasonType: params.reasonType,
        reason: params.reason || null,
        subject: params.subject.uri || params.subject.did || params.subject.cid || 'unknown',
        createdAt: new Date(),
        status: 'open',
      } as any);
      res.json({ id: report.id, success: true });
    } catch (error) {
      this._handleError(res, error, 'createReport');
    }
  }
  async searchPosts(req: Request, res: Response) {
    try {
      const params = searchPostsSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);
      const { posts, cursor } = await searchService.searchPosts(
        params.q,
        params.limit,
        params.cursor,
        viewerDid || undefined,
      );
      const serialized = await this.serializePosts(posts as any, viewerDid || undefined);
      res.json({ posts: serialized, cursor });
    } catch (error) {
      this._handleError(res, error, 'searchPosts');
    }
  }
  async searchActors(req: Request, res: Response) {
    try {
      const params = searchActorsSchema.parse(req.query);
      const term = (params.q || params.term)!;
      const { actors, cursor } = await searchService.searchActors(
        term,
        params.limit,
        params.cursor,
      );
      const dids = actors.map((a) => a.did);
      const users = await storage.getUsers(dids);
      const userMap = new Map(users.map((u) => [u.did, u]));
      const results = actors
        .map((a) => {
          const u = userMap.get(a.did);
          if (!u) return null;
          return {
            did: u.did,
            handle: u.handle,
            displayName: u.displayName,
            avatar: u.avatarUrl,
          };
        })
        .filter(Boolean);
      res.json({ actors: results, cursor });
    } catch (error) {
      this._handleError(res, error, 'searchActors');
    }
  }
  async searchActorsTypeahead(req: Request, res: Response) {
    try {
      const params = searchActorsTypeaheadSchema.parse(req.query);
      const results = await searchService.searchActorsTypeahead(
        (params.q || params.term)!,
        params.limit,
      );
      res.json({ actors: results });
    } catch (error) {
      this._handleError(res, error, 'searchActorsTypeahead');
    }
  }
  async listNotifications(req: Request, res: Response) {
    try {
      const params = listNotificationsSchema.parse(req.query);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;

      const notificationsList = await storage.getNotifications(
        userDid,
        params.limit,
        params.cursor,
      );

      const authorDids = Array.from(
        new Set(notificationsList.map((n) => n.authorDid)),
      );
      const authors = await storage.getUsers(authorDids);
      const authorMap = new Map(authors.map((a) => [a.did, a]));

      const items = notificationsList.map((n) => {
        const author = authorMap.get(n.authorDid);
        const reasonSubject = n.reasonSubject;
        const view: any = {
          uri: n.uri,
          isRead: n.isRead,
          indexedAt: n.indexedAt.toISOString(),
          reason: n.reason,
          reasonSubject,
          author: author
            ? {
                did: author.did,
                handle: author.handle,
                displayName: author.displayName,
                avatar: author.avatarUrl,
              }
            : { did: n.authorDid, handle: n.authorDid },
        };
        return view;
      });

      const cursor = notificationsList.length
        ? notificationsList[notificationsList.length - 1].indexedAt.toISOString()
        : undefined;

      res.json({ notifications: items, cursor });
    } catch (error) {
      this._handleError(res, error, 'listNotifications');
    }
  }
  async getUnreadCount(req: Request, res: Response) {
    try {
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      const count = await storage.getUnreadNotificationCount(userDid);
      res.json({ count });
    } catch (error) {
      this._handleError(res, error, 'getUnreadCount');
    }
  }
  async updateSeen(req: Request, res: Response) {
    try {
      const params = updateSeenSchema.parse(req.body);
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      await storage.markNotificationsAsRead(
        userDid,
        params.seenAt ? new Date(params.seenAt) : undefined,
      );
      res.json({ success: true });
    } catch (error) {
      this._handleError(res, error, 'updateSeen');
    }
  }
  async getList(req: Request, res: Response) {
    try {
      const params = getListSchema.parse(req.query);
      const list = await storage.getList(params.list);
      if (!list)
        return res
          .status(404)
          .json({ error: 'NotFound', message: 'List not found' });
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
      this._handleError(res, error, 'getList');
    }
  }
  async getLists(req: Request, res: Response) {
    try {
      const params = getListsSchema.parse(req.query);
      const did = await this._resolveActor(res, params.actor);
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
      this._handleError(res, error, 'getLists');
    }
  }
  async getListFeed(req: Request, res: Response) {
    try {
      const params = getListFeedSchema.parse(req.query);
      const posts = await storage.getListFeed(
        params.list,
        params.limit,
        params.cursor,
      );
      const viewerDid = await this.getAuthenticatedDid(req);
      const serialized = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );
      const oldest = posts.length ? posts[posts.length - 1] : null;
      res.json({
        cursor: oldest ? oldest.indexedAt.toISOString() : undefined,
        feed: serialized.map((p) => ({ post: p })),
      });
    } catch (error) {
      this._handleError(res, error, 'getListFeed');
    }
  }
  async getPosts(req: Request, res: Response) {
    try {
      const params = getPostsSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);
      const posts = await storage.getPosts(params.uris);
      const serializedPosts = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );
      res.json({ posts: serializedPosts });
    } catch (error) {
      this._handleError(res, error, 'getPosts');
    }
  }
  async getLikes(req: Request, res: Response) {
    try {
      const params = getLikesSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);

      const { likes, cursor } = await storage.getPostLikes(
        params.uri,
        params.limit,
        params.cursor,
      );
      const userDids = likes.map((like) => like.userDid);
      const users = await storage.getUsers(userDids);
      const userMap = new Map(users.map((u) => [u.did, u]));

      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, userDids)
        : new Map();

      res.json({
        uri: params.uri,
        cid: params.cid,
        cursor: cursor,
        likes: likes
          .map((like) => {
            const user = userMap.get(like.userDid);
            if (!user) return null;

            const viewerState = viewerDid
              ? relationships.get(like.userDid)
              : null;
            const viewer = viewerState
              ? {
                  muted: !!viewerState.muting,
                  blockedBy: viewerState.blockedBy,
                  blocking: viewerState.blocking,
                  following: viewerState.following,
                  followedBy: viewerState.followedBy,
                }
              : {};

            return {
              actor: {
                did: user.did,
                handle: user.handle,
                displayName: user.displayName,
                avatar: user.avatarUrl,
                viewer,
              },
              createdAt: like.createdAt.toISOString(),
              indexedAt: like.indexedAt.toISOString(),
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getLikes');
    }
  }
  async getRepostedBy(req: Request, res: Response) {
    try {
      const params = getRepostedBySchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);

      const { reposts, cursor } = await storage.getPostReposts(
        params.uri,
        params.limit,
        params.cursor,
      );
      const userDids = reposts.map((repost) => repost.userDid);
      const users = await storage.getUsers(userDids);
      const userMap = new Map(users.map((u) => [u.did, u]));

      const relationships = viewerDid
        ? await storage.getRelationships(viewerDid, userDids)
        : new Map();

      res.json({
        uri: params.uri,
        cid: params.cid,
        cursor: cursor,
        repostedBy: reposts
          .map((repost) => {
            const user = userMap.get(repost.userDid);
            if (!user) return null;

            const viewerState = viewerDid
              ? relationships.get(repost.userDid)
              : null;
            const viewer = viewerState
              ? {
                  muted: !!viewerState.muting,
                  blockedBy: viewerState.blockedBy,
                  blocking: viewerState.blocking,
                  following: viewerState.following,
                  followedBy: viewerState.followedBy,
                }
              : {};

            return {
              did: user.did,
              handle: user.handle,
              displayName: user.displayName,
              avatar: user.avatarUrl,
              viewer,
              indexedAt: repost.indexedAt.toISOString(),
            };
          })
          .filter(Boolean),
      });
    } catch (error) {
      this._handleError(res, error, 'getRepostedBy');
    }
  }
  async getQuotes(req: Request, res: Response) {
    try {
      const params = getQuotesSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);
      const posts = await storage.getQuotePosts(
        params.uri,
        params.limit,
        params.cursor,
      );
      const serialized = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );
      const oldest = posts.length ? posts[posts.length - 1] : null;
      res.json({
        posts: serialized,
        cursor: oldest ? oldest.indexedAt.toISOString() : undefined,
        uri: params.uri,
        cid: params.cid,
      });
    } catch (error) {
      this._handleError(res, error, 'getQuotes');
    }
  }
  async getActorLikes(req: Request, res: Response) {
    try {
      const params = getActorLikesSchema.parse(req.query);
      const viewerDid = await this.getAuthenticatedDid(req);

      let actorDid = params.actor;
      if (!params.actor.startsWith('did:')) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: 'Actor not found' });
        }
        actorDid = user.did;
      }

      const { likes, cursor } = await storage.getActorLikes(
        actorDid,
        params.limit,
        params.cursor,
      );

      const postUris = likes.map((like) => like.postUri);
      const posts = await storage.getPosts(postUris);
      const serializedPosts = await this.serializePosts(
        posts,
        viewerDid || undefined,
      );

      res.json({
        cursor,
        feed: serializedPosts.map((post) => ({ post })),
      });
    } catch (error) {
      this._handleError(res, error, 'getActorLikes');
    }
  }
}

export const xrpcApi = new XRPCApi();
