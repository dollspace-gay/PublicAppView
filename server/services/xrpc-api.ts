import type { Request, Response } from "express";
import { storage } from "../storage";
import { authService } from "./auth";
import { contentFilter } from "./content-filter";
import { feedAlgorithm } from "./feed-algorithm";
import { feedGeneratorClient } from "./feed-generator-client";
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

export class XRPCApi {
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

  // Helper method to serialize posts with all required AT Protocol fields
  private async serializePost(post: any, viewerDid?: string) {
    const [author, likeUri, repostUri] = await Promise.all([
      storage.getUser(post.authorDid),
      viewerDid ? storage.getLikeUri(viewerDid, post.uri) : undefined,
      viewerDid ? storage.getRepostUri(viewerDid, post.uri) : undefined
    ]);
    
    // Build reply field if this is a reply - fetch actual CIDs from parent and root posts
    let reply = undefined;
    if (post.parentUri) {
      const parentPost = await storage.getPost(post.parentUri);
      const rootUri = post.rootUri || post.parentUri;
      const rootPost = rootUri === post.parentUri ? parentPost : await storage.getPost(rootUri);
      
      // Only include reply if we have the actual CIDs from parent/root posts
      // Don't fabricate CIDs - AT Protocol clients need accurate references
      if (parentPost && rootPost) {
        reply = {
          root: {
            uri: rootUri,
            cid: rootPost.cid,
          },
          parent: {
            uri: post.parentUri,
            cid: parentPost.cid,
          },
        };
      }
    }

    // Build record with full AT Protocol schema
    const record: any = {
      $type: "app.bsky.feed.post",
      text: post.text,
      createdAt: post.createdAt.toISOString(),
    };

    // Add embed if present
    if (post.embed) {
      record.embed = post.embed;
    }

    // Add facets if present (would need to extract from record)
    if (post.facets) {
      record.facets = post.facets;
    }

    // Add reply reference if this is a reply
    if (reply) {
      record.reply = reply;
    }

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
      viewer: viewerDid ? {
        like: likeUri,
        repost: repostUri,
      } : {},
    };
  }

  async getTimeline(req: Request, res: Response) {
    try {
      const params = getTimelineSchema.parse(req.query);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      let posts = await storage.getTimeline(userDid, params.limit, params.cursor);
      
      // Apply content filtering if user has settings
      const settings = await storage.getUserSettings(userDid);
      if (settings) {
        posts = contentFilter.filterPosts(posts, settings);
      }
      
      // Determine algorithm: use query param, then user preference, then default
      let algorithmParam = params.algorithm;
      if (!algorithmParam && settings?.feedPreferences) {
        const prefs = settings.feedPreferences as { algorithm?: string };
        algorithmParam = prefs.algorithm;
      }
      const algorithm = feedAlgorithm.parseAlgorithm(algorithmParam);
      
      // Apply feed algorithm
      const rankedPosts = await feedAlgorithm.applyAlgorithm(posts, algorithm);
      
      // For cursor, use the oldest post chronologically from the original set
      // to ensure pagination works correctly regardless of ranking
      const oldestPost = posts.length > 0 
        ? posts.reduce((oldest, post) => 
            post.indexedAt < oldest.indexedAt ? post : oldest
          )
        : null;
      
      res.json({
        cursor: oldestPost ? oldestPost.indexedAt.toISOString() : undefined,
        feed: await Promise.all(rankedPosts.map(async post => ({
          post: await this.serializePost(post, userDid),
        }))),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getAuthorFeed(req: Request, res: Response) {
    try {
      const params = getAuthorFeedSchema.parse(req.query);
      
      // Resolve handle to DID if needed
      let authorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        authorDid = user.did;
      }

      let posts = await storage.getAuthorPosts(authorDid, params.limit, params.cursor);
      
      // Apply content filtering based on viewer preferences
      const viewerDid = await this.getAuthenticatedDid(req);
      if (viewerDid) {
        const settings = await storage.getUserSettings(viewerDid);
        if (settings) {
          posts = contentFilter.filterPosts(posts, settings);
        }
      }
      
      res.json({
        cursor: posts.length > 0 ? posts[posts.length - 1].indexedAt.toISOString() : undefined,
        feed: await Promise.all(posts.map(async post => ({
          post: await this.serializePost(post, viewerDid || undefined),
        }))),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getPostThread(req: Request, res: Response) {
    try {
      const params = getPostThreadSchema.parse(req.query);
      
      let posts = await storage.getPostThread(params.uri);
      
      if (posts.length === 0) {
        return res.status(404).json({ error: "Post not found" });
      }

      const viewerDid = await this.getAuthenticatedDid(req);

      // Apply content filtering to replies (not the root post)
      let replies = posts.slice(1);
      if (viewerDid) {
        const settings = await storage.getUserSettings(viewerDid);
        if (settings) {
          replies = contentFilter.filterPosts(replies, settings);
        }
      }

      const threadPost = await this.serializePost(posts[0], viewerDid || undefined);
      const threadReplies = await Promise.all(
        replies.map(reply => this.serializePost(reply, viewerDid || undefined))
      );

      const threadView: any = {
        $type: "app.bsky.feed.defs#threadViewPost",
        post: threadPost,
        replies: threadReplies.map(reply => ({
          $type: "app.bsky.feed.defs#threadViewPost",
          post: reply,
        })),
      };

      res.json({
        thread: threadView,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
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
      console.error('[XRPC] Error getting profile:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
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
      console.error('[XRPC] Error getting profiles:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid request' });
    }
  }

  private async _getProfiles(actors: string[], req: Request) {
    const viewerDid = await this.getAuthenticatedDid(req);

    const dids = await Promise.all(
      actors.map(async (actor) => {
        if (actor.startsWith('did:')) {
          return actor;
        }
        const user = await storage.getUserByHandle(actor);
        return user?.did;
      }),
    );
    const uniqueDids = Array.from(new Set(dids.filter(Boolean))) as string[];

    if (uniqueDids.length === 0) {
      return [];
    }

    const users = await storage.getUsers(uniqueDids);
    const userMap = new Map(users.map((u) => [u.did, u]));

    const [
      followersCounts,
      followingCounts,
      postsCounts,
      listCounts,
      feedgenCounts,
      profileRecords,
      allLabels,
      relationships,
      mutingLists,
      knownFollowersResults,
    ] = await Promise.all([
      Promise.all(uniqueDids.map((did) => storage.getUserFollowerCount(did))),
      Promise.all(uniqueDids.map((did) => storage.getUserFollowingCount(did))),
      Promise.all(uniqueDids.map((did) => storage.getUserPostCount(did))),
      Promise.all(uniqueDids.map((did) => storage.getUserListCount(did))),
      Promise.all(
        uniqueDids.map((did) => storage.getUserFeedGeneratorCount(did)),
      ),
      Promise.all(uniqueDids.map((did) => storage.getUserProfileRecord(did))),
      storage.getLabelsForSubjects(uniqueDids),
      viewerDid
        ? storage.getRelationships(viewerDid, uniqueDids)
        : Promise.resolve(new Map()),
      viewerDid
        ? Promise.all(
            uniqueDids.map((did) =>
              storage.findMutingListForUser(viewerDid, did),
            ),
          )
        : Promise.resolve([]),
      viewerDid
        ? Promise.all(
            uniqueDids.map((did) =>
              storage.getKnownFollowers(did, viewerDid, 5),
            ),
          )
        : Promise.resolve([]),
    ]);

    const labelsBySubject = new Map<string, any[]>();
    allLabels.forEach((label) => {
      if (!labelsBySubject.has(label.subject)) {
        labelsBySubject.set(label.subject, []);
      }
      labelsBySubject.get(label.subject)!.push(label);
    });

    const pinnedPostUris = profileRecords
      .map((p) => p?.pinnedPost?.uri)
      .filter(Boolean) as string[];
    const pinnedPosts = await storage.getPosts(pinnedPostUris);
    const serializedPinnedPosts = new Map<string, any>();
    for (const post of pinnedPosts) {
      serializedPinnedPosts.set(
        post.uri,
        await this.serializePost(post, viewerDid || undefined),
      );
    }

    const profiles = uniqueDids
      .map((did, i) => {
        const user = userMap.get(did);
        if (!user) return null;

        const profileRecord = profileRecords[i];
        const pinnedPostUri = profileRecord?.pinnedPost?.uri;
        const pinnedPostView = pinnedPostUri
          ? serializedPinnedPosts.get(pinnedPostUri)
          : undefined;

        const viewerState = viewerDid ? relationships.get(did) : null;
        const mutingList = viewerDid ? mutingLists[i] : null;
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

        return {
          $type: 'app.bsky.actor.defs#profileViewDetailed',
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          description: user.description,
          avatar: user.avatarUrl,
          banner: user.bannerUrl,
          followersCount: followersCounts[i],
          followingCount: followingCounts[i],
          postsCount: postsCounts[i],
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
            lists: listCounts[i],
            feedgens: feedgenCounts[i],
          },
          pinnedPost: pinnedPostView,
        };
      })
      .filter(Boolean);

    return profiles;
  }

  async getFollows(req: Request, res: Response) {
    try {
      const params = getFollowsSchema.parse(req.query);
      
      let actorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        actorDid = user.did;
      }

      const follows = await storage.getFollows(actorDid, params.limit);
      const followDids = follows.map(f => f.followingDid);
      const followUsers = await storage.getUsers(followDids);
      
      res.json({
        subject: { did: actorDid },
        follows: followUsers.map(u => ({
          $type: "app.bsky.actor.defs#profileView",
          did: u.did,
          handle: u.handle,
          displayName: u.displayName,
          avatar: u.avatarUrl,
          indexedAt: u.indexedAt.toISOString(),
          viewer: {}
        })),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getFollowers(req: Request, res: Response) {
    try {
      const params = getFollowsSchema.parse(req.query);
      
      let actorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        actorDid = user.did;
      }

      const followers = await storage.getFollowers(actorDid, params.limit);
      const followerDids = followers.map(f => f.followerDid);
      const followerUsers = await storage.getUsers(followerDids);
      
      res.json({
        subject: { did: actorDid },
        followers: followerUsers.map(u => ({
          $type: "app.bsky.actor.defs#profileView",
          did: u.did,
          handle: u.handle,
          displayName: u.displayName,
          avatar: u.avatarUrl,
          indexedAt: u.indexedAt.toISOString(),
          viewer: {}
        })),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getSuggestions(req: Request, res: Response) {
    try {
      const params = getSuggestionsSchema.parse(req.query);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      const users = await storage.getSuggestedUsers(userDid, params.limit);
      
      res.json({
        actors: users.map(user => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          description: user.description,
          avatar: user.avatarUrl,
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting suggestions:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }


  async getBlocks(req: Request, res: Response) {
    try {
      const params = getBlocksSchema.parse(req.query);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      const { blocks, cursor } = await storage.getBlocks(userDid, params.limit, params.cursor);
      
      res.json({
        cursor,
        blocks: await Promise.all(blocks.map(async (block) => {
          const user = await storage.getUser(block.blockedDid);
          return {
            did: block.blockedDid,
            handle: user?.handle || block.blockedDid,
            displayName: user?.displayName,
            avatar: user?.avatarUrl,
          };
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting blocks:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getMutes(req: Request, res: Response) {
    try {
      const params = getMutesSchema.parse(req.query);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      const { mutes, cursor } = await storage.getMutes(userDid, params.limit, params.cursor);
      
      res.json({
        cursor,
        mutes: await Promise.all(mutes.map(async (mute) => {
          const user = await storage.getUser(mute.mutedDid);
          return {
            did: mute.mutedDid,
            handle: user?.handle || mute.mutedDid,
            displayName: user?.displayName,
            avatar: user?.avatarUrl,
          };
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting mutes:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async muteActor(req: Request, res: Response) {
    try {
      const params = muteActorSchema.parse(req.body);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      let mutedDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const targetUser = await storage.getUserByHandle(params.actor);
        if (!targetUser) {
          return res.status(404).json({ error: "Actor not found" });
        }
        mutedDid = targetUser.did;
      }
      
      await storage.createMute({
        uri: `at://${userDid}/app.bsky.graph.mute/${Date.now()}`,
        muterDid: userDid,
        mutedDid,
        createdAt: new Date(),
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("[XRPC] Error muting actor:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async unmuteActor(req: Request, res: Response) {
    try {
      const params = muteActorSchema.parse(req.body);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      let mutedDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        mutedDid = user.did;
      }
      
      const { mutes } = await storage.getMutes(userDid, 1000);
      const mute = mutes.find(m => m.mutedDid === mutedDid);
      
      if (mute) {
        await storage.deleteMute(mute.uri);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("[XRPC] Error unmuting actor:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getRelationships(req: Request, res: Response) {
    try {
      const params = getRelationshipsSchema.parse(req.query);
      
      let actorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        actorDid = user.did;
      }
      
      const targetDids = params.others || [];
      const relationships = await storage.getRelationships(actorDid, targetDids);
      
      res.json({
        actor: params.actor,
        relationships: Array.from(relationships.entries()).map(([did, rel]) => ({
          did,
          following: rel.following ? `at://${actorDid}/app.bsky.graph.follow/${did}` : undefined,
          followedBy: rel.followedBy ? `at://${did}/app.bsky.graph.follow/${actorDid}` : undefined,
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting relationships:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getListMutes(req: Request, res: Response) {
    try {
      const params = getListMutesSchema.parse(req.query);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      const { mutes, cursor } = await storage.getListMutes(userDid, params.limit, params.cursor);
      
      res.json({
        cursor,
        lists: await Promise.all(mutes.map(async (listMute) => {
          const list = await storage.getList(listMute.listUri);
          return list ? {
            uri: list.uri,
            name: list.name,
            purpose: list.purpose,
          } : null;
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting list mutes:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getListBlocks(req: Request, res: Response) {
    try {
      const params = getListBlocksSchema.parse(req.query);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      const { blocks, cursor } = await storage.getListBlocks(userDid, params.limit, params.cursor);
      
      res.json({
        cursor,
        lists: await Promise.all(blocks.map(async (listBlock) => {
          const list = await storage.getList(listBlock.listUri);
          return list ? {
            uri: list.uri,
            name: list.name,
            purpose: list.purpose,
          } : null;
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting list blocks:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getKnownFollowers(req: Request, res: Response) {
    try {
      const params = getKnownFollowersSchema.parse(req.query);
      
      const viewerDid = await this.requireAuthDid(req, res);
      if (!viewerDid) return;
      
      let actorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        actorDid = user.did;
      }
      
      const { followers, cursor } = await storage.getKnownFollowers(actorDid, viewerDid, params.limit, params.cursor);
      
      res.json({
        subject: params.actor,
        cursor,
        followers: followers.map(user => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          avatar: user.avatarUrl,
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting known followers:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getSuggestedFollowsByActor(req: Request, res: Response) {
    try {
      const params = getSuggestedFollowsByActorSchema.parse(req.query);
      
      let actorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        actorDid = user.did;
      }
      
      const suggestions = await storage.getSuggestedFollowsByActor(actorDid, params.limit);
      
      res.json({
        suggestions: suggestions.map(user => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          description: user.description,
          avatar: user.avatarUrl,
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting suggested follows:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
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
        return res.status(404).json({ error: "List not found" });
      }
      
      await storage.createListMute({
        uri: `at://${userDid}/app.bsky.graph.listMute/${Date.now()}`,
        muterDid: userDid,
        listUri: params.list,
        createdAt: new Date(),
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("[XRPC] Error muting actor list:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async unmuteActorList(req: Request, res: Response) {
    try {
      const params = unmuteActorListSchema.parse(req.body);
      
      const userDid = await this.requireAuthDid(req, res);
      if (!userDid) return;
      
      const { mutes } = await storage.getListMutes(userDid, 1000);
      const mute = mutes.find(m => m.listUri === params.list);
      
      if (mute) {
        await storage.deleteListMute(mute.uri);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("[XRPC] Error unmuting actor list:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
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
        return res.status(404).json({ error: "Thread root post not found" });
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
      console.error("[XRPC] Error muting thread:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
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
        return res.status(404).json({ error: "Feed generator not found" });
      }
      
      console.log(`[XRPC] Getting feed from generator: ${feedGen.displayName} (${feedGen.did})`);
      
      // Call external feed generator service to get skeleton
      // Then hydrate with full post data from our database
      const { feed: hydratedFeed, cursor } = await feedGeneratorClient.getFeed(
        feedGen.did,
        {
          feed: params.feed,
          limit: params.limit,
          cursor: params.cursor,
        }
      );
      
      console.log(`[XRPC] Hydrated ${hydratedFeed.length} posts from feed generator`);
      
      // Build post views with author information
      const feed = await Promise.all(hydratedFeed.map(async ({ post, reason }) => {
        const author = await storage.getUser(post.authorDid);
        
        const postView: any = {
          uri: post.uri,
          cid: post.cid,
          author: {
            did: post.authorDid,
            handle: author?.handle || "unknown.user",
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
      }));
      
      res.json({ feed, cursor });
    } catch (error) {
      console.error("[XRPC] Error getting feed:", error);
      
      // If feed generator is unavailable, provide a helpful error
      if (error instanceof Error && error.message.includes("Could not resolve")) {
        return res.status(502).json({ 
          error: "Feed generator service unavailable",
          message: "The feed generator's service endpoint could not be reached"
        });
      }
      
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }
  
  async getFeedGenerator(req: Request, res: Response) {
    try {
      const params = getFeedGeneratorSchema.parse(req.query);
      
      const generator = await storage.getFeedGenerator(params.feed);
      if (!generator) {
        return res.status(404).json({ error: "Feed generator not found" });
      }
      
      const creator = await storage.getUser(generator.creatorDid);
      
      const creatorView: any = {
        did: generator.creatorDid,
        handle: creator?.handle || `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
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
      console.error("[XRPC] Error getting feed generator:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getFeedGenerators(req: Request, res: Response) {
    try {
      const params = getFeedGeneratorsSchema.parse(req.query);
      
      const generators = await storage.getFeedGenerators(params.feeds);
      
      const views = await Promise.all(generators.map(async (generator) => {
        const creator = await storage.getUser(generator.creatorDid);
        
        const creatorView: any = {
          did: generator.creatorDid,
          handle: creator?.handle || `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
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
        
        return view;
      }));
      
      res.json({ feeds: views });
    } catch (error) {
      console.error("[XRPC] Error getting feed generators:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getActorFeeds(req: Request, res: Response) {
    try {
      const params = getActorFeedsSchema.parse(req.query);
      
      let actorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        actorDid = user.did;
      }
      
      const { generators, cursor } = await storage.getActorFeeds(actorDid, params.limit, params.cursor);
      
      const feeds = await Promise.all(generators.map(async (generator) => {
        const creator = await storage.getUser(generator.creatorDid);
        
        const creatorView: any = {
          did: generator.creatorDid,
          handle: creator?.handle || `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
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
        
        return view;
      }));
      
      res.json({ cursor, feeds });
    } catch (error) {
      console.error("[XRPC] Error getting actor feeds:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getSuggestedFeeds(req: Request, res: Response) {
    try {
      const params = getSuggestedFeedsSchema.parse(req.query);
      
      const { generators, cursor } = await storage.getSuggestedFeeds(params.limit, params.cursor);
      
      const feeds = await Promise.all(generators.map(async (generator) => {
        const creator = await storage.getUser(generator.creatorDid);
        
        const creatorView: any = {
          did: generator.creatorDid,
          handle: creator?.handle || `${generator.creatorDid.replace(/:/g, '-')}.invalid`,
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
        
        return view;
      }));
      
      res.json({ cursor, feeds });
    } catch (error) {
      console.error("[XRPC] Error getting suggested feeds:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async describeFeedGenerator(req: Request, res: Response) {
    try {
      describeFeedGeneratorSchema.parse(req.query);
      
      res.json({
        did: "did:web:appview.local",
        feeds: [
          {
            uri: "at://did:web:appview.local/app.bsky.feed.generator/reverse-chron",
          },
        ],
      });
    } catch (error) {
      console.error("[XRPC] Error describing feed generator:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  // Starter Pack endpoints
  async getStarterPack(req: Request, res: Response) {
    try {
      const params = getStarterPackSchema.parse(req.query);
      
      const pack = await storage.getStarterPack(params.starterPack);
      if (!pack) {
        return res.status(404).json({ error: "Starter pack not found" });
      }
      
      const creator = await storage.getUser(pack.creatorDid);
      let list = null;
      if (pack.listUri) {
        list = await storage.getList(pack.listUri);
      }
      
      const creatorView: any = {
        did: pack.creatorDid,
        handle: creator?.handle || `${pack.creatorDid.replace(/:/g, '-')}.invalid`,
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
      console.error("[XRPC] Error getting starter pack:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getStarterPacks(req: Request, res: Response) {
    try {
      const params = getStarterPacksSchema.parse(req.query);
      
      const packs = await storage.getStarterPacks(params.uris);
      
      const views = await Promise.all(packs.map(async (pack) => {
        const creator = await storage.getUser(pack.creatorDid);
        let list = null;
        if (pack.listUri) {
          list = await storage.getList(pack.listUri);
        }
        
        const creatorView: any = {
          did: pack.creatorDid,
          handle: creator?.handle || `handle.invalid`,
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
      }));
      
      res.json({ starterPacks: views });
    } catch (error) {
      console.error("[XRPC] Error getting starter packs:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
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
        })
      );
      
      // Flatten array of arrays
      const services = allServices.flat();
      
      const views = await Promise.all(services.map(async (service) => {
        const creator = await storage.getUser(service.creatorDid);
        
        const creatorView: any = {
          did: service.creatorDid,
          handle: creator?.handle || `${service.creatorDid.replace(/:/g, '-')}.invalid`,
        };
        if (creator?.displayName) creatorView.displayName = creator.displayName;
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
          view.labels = labels.map(label => {
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
      }));
      
      res.json({ views });
    } catch (error) {
      console.error("[XRPC] Error getting labeler services:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  // app.bsky.notification.registerPush
  async registerPush(req: Request, res: Response) {
    try {
      const params = registerPushSchema.parse(req.body);
      
      // Get authenticated user from session
      const userDid = (req as any).user?.did;
      if (!userDid) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
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
      console.error("[XRPC] Error registering push:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  // app.bsky.notification.putPreferences
  async putNotificationPreferences(req: Request, res: Response) {
    try {
      const params = putNotificationPreferencesSchema.parse(req.body);
      
      // Get authenticated user from session
      const userDid = (req as any).user?.did;
      if (!userDid) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      // Get existing preferences or create new ones if they don't exist
      let prefs = await storage.getUserPreferences(userDid);
      if (!prefs) {
        prefs = await storage.createUserPreferences({
          userDid,
          notificationPriority: params.priority !== undefined ? params.priority : false,
        });
      } else {
        // Update notification preferences
        prefs = await storage.updateUserPreferences(userDid, {
          notificationPriority: params.priority !== undefined ? params.priority : prefs.notificationPriority,
        });
      }
      
      res.json({
        priority: prefs?.notificationPriority ?? false,
      });
    } catch (error) {
      console.error("[XRPC] Error updating notification preferences:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  // app.bsky.video.getJobStatus
  async getJobStatus(req: Request, res: Response) {
    try {
      const params = getJobStatusSchema.parse(req.query);
      
      // Get video job
      const job = await storage.getVideoJob(params.jobId);
      
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
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
      console.error("[XRPC] Error getting job status:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  // app.bsky.video.getUploadLimits
  async getUploadLimits(req: Request, res: Response) {
    try {
      // Get authenticated user from session
      const userDid = (req as any).user?.did;
      if (!userDid) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      // Return upload limits - these are configurable per instance
      // Default limits based on Bluesky's specs
      res.json({
        canUpload: true,
        remainingDailyVideos: 10, // Simplified - production would track actual usage
        remainingDailyBytes: 100 * 1024 * 1024, // 100MB
        message: undefined,
        error: undefined,
      });
    } catch (error) {
      console.error("[XRPC] Error getting upload limits:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  // Stubs for missing methods to fix build
  async queryLabels(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async createReport(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async searchPosts(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async searchActors(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async searchActorsTypeahead(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async listNotifications(req: Request, res: Response) {
    try {
      // For an appview, it's safe to return an empty list of notifications
      // as the PDS is the source of truth for notifications.
      res.json({
        notifications: [],
        cursor: ''
      });
    } catch (error) {
      console.error("[XRPC] Error getting listNotifications:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }
  async getUnreadCount(req: Request, res: Response) {
    try {
      // For an appview, it's safe to return 0 unread notifications.
      res.json({
        count: 0
      });
    } catch (error) {
      console.error("[XRPC] Error getting getUnreadCount:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }
  async updateSeen(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getList(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getLists(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getListFeed(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getPosts(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getLikes(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getRepostedBy(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getQuotes(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
  async getActorLikes(req: Request, res: Response) { res.status(501).send("Not Implemented"); }
}

export const xrpcApi = new XRPCApi();
