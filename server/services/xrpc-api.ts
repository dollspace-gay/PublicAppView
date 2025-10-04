import type { Request, Response } from "express";
import { storage } from "../storage";
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
  uris: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).pipe(z.array(z.string()).max(25, "Maximum 25 URIs allowed per AT Protocol spec")),
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
  actors: z.union([z.string(), z.array(z.string())]).transform(val => 
    typeof val === 'string' ? [val] : val
  ).pipe(z.array(z.string()).max(25, "Maximum 25 actors allowed per AT Protocol spec")),
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
  // Helper method to serialize posts with all required AT Protocol fields
  private async serializePost(post: any, viewerDid?: string) {
    const author = await storage.getUser(post.authorDid);
    
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
        like: undefined, // Would check if viewer liked this post
        repost: undefined, // Would check if viewer reposted
      } : undefined,
    };
  }

  async getTimeline(req: Request, res: Response) {
    try {
      const params = getTimelineSchema.parse(req.query);
      
      // For demo, using a hardcoded user DID - in production, get from auth
      const userDid = "did:plc:demo";
      
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
        feed: rankedPosts.map(post => ({
          post: {
            uri: post.uri,
            cid: post.cid,
            author: { did: post.authorDid },
            record: {
              text: post.text,
              createdAt: post.createdAt.toISOString(),
            },
            indexedAt: post.indexedAt.toISOString(),
            likeCount: post.likeCount,
            repostCount: post.repostCount,
          },
        })),
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
      // In production, would get viewer DID from auth token
      const viewerDid = (req as any).user?.did || "did:plc:demo";
      const settings = await storage.getUserSettings(viewerDid);
      if (settings) {
        posts = contentFilter.filterPosts(posts, settings);
      }
      
      res.json({
        cursor: posts.length > 0 ? posts[posts.length - 1].indexedAt.toISOString() : undefined,
        feed: posts.map(post => ({
          post: {
            uri: post.uri,
            cid: post.cid,
            author: { did: post.authorDid },
            record: {
              text: post.text,
              createdAt: post.createdAt.toISOString(),
            },
            indexedAt: post.indexedAt.toISOString(),
          },
        })),
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

      // Apply content filtering to replies (not the root post)
      const viewerDid = (req as any).user?.did || "did:plc:demo";
      const settings = await storage.getUserSettings(viewerDid);
      let replies = posts.slice(1);
      if (settings) {
        replies = contentFilter.filterPosts(replies, settings);
      }

      res.json({
        thread: {
          post: {
            uri: posts[0].uri,
            cid: posts[0].cid,
            author: { did: posts[0].authorDid },
            record: {
              text: posts[0].text,
              createdAt: posts[0].createdAt.toISOString(),
            },
            replies: replies.map(reply => ({
              post: {
                uri: reply.uri,
                cid: reply.cid,
                author: { did: reply.authorDid },
                record: {
                  text: reply.text,
                  createdAt: reply.createdAt.toISOString(),
                },
              },
            })),
          },
        },
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getProfile(req: Request, res: Response) {
    try {
      const params = getProfileSchema.parse(req.query);
      
      let user;
      if (params.actor.startsWith("did:")) {
        user = await storage.getUser(params.actor);
      } else {
        user = await storage.getUserByHandle(params.actor);
      }

      if (!user) {
        return res.status(404).json({ error: "Profile not found" });
      }

      res.json({
        did: user.did,
        handle: user.handle,
        displayName: user.displayName,
        description: user.description,
        avatar: user.avatarUrl,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
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
      
      res.json({
        subject: { did: actorDid },
        follows: follows.map(f => ({
          did: f.followingDid,
          handle: f.followingDid,
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
      
      res.json({
        subject: { did: actorDid },
        followers: followers.map(f => ({
          did: f.followerDid,
          handle: f.followerDid,
        })),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async queryLabels(req: Request, res: Response) {
    try {
      const params = queryLabelsSchema.parse(req.query);
      
      // Extract subjects from uriPatterns (can be URIs or DIDs)
      const subjects = params.uriPatterns || [];
      
      const labels = await labelService.queryLabels({
        subjects: subjects.length > 0 ? subjects : undefined,
        sources: params.sources,
        limit: params.limit,
      });

      res.json({
        labels: labels.map(label => ({
          ver: 1,
          src: label.src,
          uri: label.subject,
          cid: "",
          val: label.val,
          neg: label.neg,
          cts: label.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async createReport(req: Request, res: Response) {
    try {
      const params = createReportSchema.parse(req.body);
      
      // For demo, using a hardcoded reporter DID - in production, get from auth
      const reporterDid = "did:plc:reporter";
      
      // Determine subject (URI or DID)
      const subject = params.subject.uri || params.subject.did;
      if (!subject) {
        return res.status(400).json({ error: "Subject must have either uri or did" });
      }

      // Determine subject type from $type
      let subjectType: "post" | "account" | "message" = "post";
      if (params.subject.$type.includes("profile") || params.subject.$type.includes("actor")) {
        subjectType = "account";
      } else if (params.subject.$type.includes("message")) {
        subjectType = "message";
      }

      const report = await moderationService.createReport({
        subject,
        subjectType,
        reportType: params.reasonType,
        reason: params.reason,
        reporterDid,
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
        reportedBy: report.reporterDid,
        createdAt: report.createdAt.toISOString(),
      });
    } catch (error) {
      console.error("[XRPC] Error creating report:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async searchPosts(req: Request, res: Response) {
    try {
      const params = searchPostsSchema.parse(req.query);
      const userDid = (req as any).session?.userDid;

      const result = await searchService.searchPosts(
        params.q,
        params.limit,
        params.cursor,
        userDid
      );

      res.json({
        posts: result.posts.map(post => ({
          uri: post.uri,
          cid: post.cid,
          author: {
            did: post.authorDid,
          },
          record: {
            text: post.text,
            createdAt: post.createdAt instanceof Date ? post.createdAt.toISOString() : post.createdAt,
          },
          indexedAt: post.indexedAt instanceof Date ? post.indexedAt.toISOString() : post.indexedAt,
        })),
        cursor: result.cursor,
      });
    } catch (error) {
      console.error("[XRPC] Error searching posts:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async searchActors(req: Request, res: Response) {
    try {
      const params = searchActorsSchema.parse(req.query);
      const query = params.q || params.term || "";

      const result = await searchService.searchActors(
        query,
        params.limit,
        params.cursor
      );

      res.json({
        actors: result.actors.map(actor => ({
          did: actor.did,
          handle: actor.handle,
          displayName: actor.displayName,
          avatar: actor.avatarUrl,
          description: actor.description,
        })),
        cursor: result.cursor,
      });
    } catch (error) {
      console.error("[XRPC] Error searching actors:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async searchActorsTypeahead(req: Request, res: Response) {
    try {
      const params = searchActorsTypeaheadSchema.parse(req.query);
      const query = params.q || params.term || "";

      const actors = await searchService.searchActorsTypeahead(query, params.limit);

      res.json({
        actors: actors.map(actor => ({
          did: actor.did,
          handle: actor.handle,
          displayName: actor.displayName,
          avatar: actor.avatarUrl,
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error in typeahead search:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async listNotifications(req: Request, res: Response) {
    try {
      const params = listNotificationsSchema.parse(req.query);
      // TODO: Get userDid from authenticated session (req.session.userDid)
      // For now using hardcoded DID for demo purposes
      const userDid = "did:plc:demo";
      
      // Filter notifications by seenAt if provided
      let notifications = await storage.getNotifications(userDid, params.limit, params.cursor);
      
      if (params.seenAt) {
        const seenDate = new Date(params.seenAt);
        notifications = notifications.filter(n => n.indexedAt <= seenDate);
      }
      
      const formattedNotifications = await Promise.all(notifications.map(async (notif) => {
        const author = await storage.getUser(notif.authorDid);
        
        return {
          uri: notif.uri,
          cid: notif.uri,
          author: {
            did: notif.authorDid,
            handle: author?.handle || notif.authorDid,
            displayName: author?.displayName,
            avatar: author?.avatarUrl,
          },
          reason: notif.reason,
          reasonSubject: notif.reasonSubject,
          record: {},
          isRead: notif.isRead,
          indexedAt: notif.indexedAt.toISOString(),
        };
      }));

      const cursor = notifications.length > 0 
        ? notifications[notifications.length - 1].indexedAt.toISOString()
        : undefined;

      res.json({
        cursor,
        notifications: formattedNotifications,
      });
    } catch (error) {
      console.error("[XRPC] Error listing notifications:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getUnreadCount(req: Request, res: Response) {
    try {
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      const count = await storage.getUnreadNotificationCount(userDid);
      
      res.json({ count });
    } catch (error) {
      console.error("[XRPC] Error getting unread count:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async updateSeen(req: Request, res: Response) {
    try {
      const params = updateSeenSchema.parse(req.body);
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
      const seenAt = new Date(params.seenAt);
      await storage.markNotificationsAsRead(userDid, seenAt);
      
      res.json({ success: true });
    } catch (error) {
      console.error("[XRPC] Error updating seen:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getList(req: Request, res: Response) {
    try {
      const params = getListSchema.parse(req.query);
      const list = await storage.getList(params.list);
      
      if (!list) {
        return res.status(404).json({ error: "List not found" });
      }

      const items = await storage.getListItems(params.list, params.limit);
      const creator = await storage.getUser(list.creatorDid);
      
      res.json({
        list: {
          uri: list.uri,
          cid: list.cid,
          name: list.name,
          purpose: list.purpose,
          description: list.description,
          avatar: list.avatarUrl,
          creator: {
            did: list.creatorDid,
            handle: creator?.handle || list.creatorDid,
            displayName: creator?.displayName,
          },
          indexedAt: list.indexedAt.toISOString(),
        },
        items: await Promise.all(items.map(async (item) => {
          const subject = await storage.getUser(item.subjectDid);
          return {
            uri: item.uri,
            subject: {
              did: item.subjectDid,
              handle: subject?.handle || item.subjectDid,
              displayName: subject?.displayName,
              avatar: subject?.avatarUrl,
            },
          };
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting list:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getLists(req: Request, res: Response) {
    try {
      const params = getListsSchema.parse(req.query);
      const lists = await storage.getUserLists(params.actor, params.limit);
      
      res.json({
        lists: await Promise.all(lists.map(async (list) => {
          const creator = await storage.getUser(list.creatorDid);
          return {
            uri: list.uri,
            cid: list.cid,
            name: list.name,
            purpose: list.purpose,
            description: list.description,
            avatar: list.avatarUrl,
            creator: {
              did: list.creatorDid,
              handle: creator?.handle || list.creatorDid,
              displayName: creator?.displayName,
            },
            indexedAt: list.indexedAt.toISOString(),
          };
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting lists:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getListFeed(req: Request, res: Response) {
    try {
      const params = getListFeedSchema.parse(req.query);
      const posts = await storage.getListFeed(params.list, params.limit, params.cursor);
      
      const cursor = posts.length > 0 
        ? posts[posts.length - 1].indexedAt.toISOString()
        : undefined;

      res.json({
        cursor,
        feed: posts.map(post => ({
          post: {
            uri: post.uri,
            cid: post.cid,
            author: { did: post.authorDid },
            record: {
              text: post.text,
              createdAt: post.createdAt.toISOString(),
            },
            indexedAt: post.indexedAt.toISOString(),
          },
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting list feed:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getPosts(req: Request, res: Response) {
    try {
      const params = getPostsSchema.parse(req.query);
      const viewerDid = (req as any).user?.did;
      const posts = await storage.getPosts(params.uris);
      
      res.json({
        posts: await Promise.all(posts.map(post => this.serializePost(post, viewerDid))),
      });
    } catch (error) {
      console.error("[XRPC] Error getting posts:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getLikes(req: Request, res: Response) {
    try {
      const params = getLikesSchema.parse(req.query);
      const { likes, cursor } = await storage.getPostLikes(params.uri, params.limit, params.cursor);
      
      res.json({
        uri: params.uri,
        cid: params.cid,
        cursor,
        likes: await Promise.all(likes.map(async (like) => {
          const user = await storage.getUser(like.userDid);
          return {
            indexedAt: like.indexedAt.toISOString(),
            createdAt: like.createdAt.toISOString(),
            actor: {
              did: like.userDid,
              handle: user?.handle || like.userDid,
              displayName: user?.displayName,
              avatar: user?.avatarUrl,
            },
          };
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting likes:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getRepostedBy(req: Request, res: Response) {
    try {
      const params = getRepostedBySchema.parse(req.query);
      const { reposts, cursor } = await storage.getPostReposts(params.uri, params.limit, params.cursor);
      
      res.json({
        uri: params.uri,
        cid: params.cid,
        cursor,
        repostedBy: await Promise.all(reposts.map(async (repost) => {
          const user = await storage.getUser(repost.userDid);
          return {
            did: repost.userDid,
            handle: user?.handle || repost.userDid,
            displayName: user?.displayName,
            avatar: user?.avatarUrl,
          };
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting reposts:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getQuotes(req: Request, res: Response) {
    try {
      const params = getQuotesSchema.parse(req.query);
      const viewerDid = (req as any).user?.did;
      const posts = await storage.getQuotePosts(params.uri, params.limit, params.cursor);
      
      const cursor = posts.length > 0 
        ? posts[posts.length - 1].indexedAt.toISOString()
        : undefined;
      
      res.json({
        uri: params.uri,
        cid: params.cid,
        cursor,
        posts: await Promise.all(posts.map(post => this.serializePost(post, viewerDid))),
      });
    } catch (error) {
      console.error("[XRPC] Error getting quotes:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getActorLikes(req: Request, res: Response) {
    try {
      const params = getActorLikesSchema.parse(req.query);
      const viewerDid = (req as any).user?.did;
      
      let actorDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const user = await storage.getUserByHandle(params.actor);
        if (!user) {
          return res.status(404).json({ error: "Actor not found" });
        }
        actorDid = user.did;
      }
      
      const { likes, cursor } = await storage.getActorLikes(actorDid, params.limit, params.cursor);
      
      res.json({
        cursor,
        feed: await Promise.all(likes.map(async (like) => {
          const post = await storage.getPost(like.postUri);
          return {
            post: post ? await this.serializePost(post, viewerDid) : null,
          };
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting actor likes:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getProfiles(req: Request, res: Response) {
    try {
      const params = getProfilesSchema.parse(req.query);
      
      const dids: string[] = [];
      for (const actor of params.actors) {
        if (actor.startsWith("did:")) {
          dids.push(actor);
        } else {
          const user = await storage.getUserByHandle(actor);
          if (user) dids.push(user.did);
        }
      }
      
      const users = await storage.getUsers(dids);
      
      res.json({
        profiles: users.map(user => ({
          did: user.did,
          handle: user.handle,
          displayName: user.displayName,
          description: user.description,
          avatar: user.avatarUrl,
          indexedAt: user.indexedAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error("[XRPC] Error getting profiles:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getSuggestions(req: Request, res: Response) {
    try {
      const params = getSuggestionsSchema.parse(req.query);
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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

  async getPreferences(req: Request, res: Response) {
    try {
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
      const prefs = await storage.getUserPreferences(userDid);
      
      res.json({
        preferences: prefs ? [
          {
            $type: "app.bsky.actor.defs#adultContentPref",
            enabled: prefs.adultContent,
          },
          {
            $type: "app.bsky.actor.defs#contentLabelPref",
            ...(prefs.contentLabels as object),
          },
          {
            $type: "app.bsky.actor.defs#feedViewPref",
            ...(prefs.feedViewPrefs as object),
          },
        ] : [],
      });
    } catch (error) {
      console.error("[XRPC] Error getting preferences:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async putPreferences(req: Request, res: Response) {
    try {
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      const preferences = req.body.preferences || [];
      
      // Ensure demo user exists for testing (use DID-based handle to avoid collisions)
      let user = await storage.getUser(userDid);
      if (!user) {
        const safeHandle = userDid.replace(/[:.]/g, '-') + '-stub';
        try {
          await storage.createUser({
            did: userDid,
            handle: safeHandle,
            displayName: "Demo User (Stub)",
          });
        } catch (error: any) {
          // Tolerate concurrent creation attempts or existing user
          if (error?.code !== '23505') throw error;
        }
      }
      
      const prefs: any = {
        userDid,
        adultContent: false,
        contentLabels: {},
        feedViewPrefs: {},
        threadViewPrefs: {},
        interests: [],
      };
      
      for (const pref of preferences) {
        if (pref.$type === "app.bsky.actor.defs#adultContentPref") {
          prefs.adultContent = pref.enabled;
        } else if (pref.$type === "app.bsky.actor.defs#contentLabelPref") {
          prefs.contentLabels = pref;
        } else if (pref.$type === "app.bsky.actor.defs#feedViewPref") {
          prefs.feedViewPrefs = pref;
        } else if (pref.$type === "app.bsky.actor.defs#threadViewPref") {
          prefs.threadViewPrefs = pref;
        }
      }
      
      await storage.createUserPreferences(prefs);
      
      res.json({ success: true });
    } catch (error) {
      console.error("[XRPC] Error putting preferences:", error);
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid request" });
    }
  }

  async getBlocks(req: Request, res: Response) {
    try {
      const params = getBlocksSchema.parse(req.query);
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
      // Ensure demo user exists for testing (use DID-based handle to avoid collisions)
      let user = await storage.getUser(userDid);
      if (!user) {
        const safeHandle = userDid.replace(/[:.]/g, '-') + '-stub';
        try {
          await storage.createUser({
            did: userDid,
            handle: safeHandle,
            displayName: "Demo User (Stub)",
          });
        } catch (error: any) {
          // Tolerate concurrent creation attempts or existing user
          if (error?.code !== '23505') throw error;
        }
      }
      
      let mutedDid = params.actor;
      if (!params.actor.startsWith("did:")) {
        const targetUser = await storage.getUserByHandle(params.actor);
        if (!targetUser) {
          return res.status(404).json({ error: "Actor not found" });
        }
        mutedDid = targetUser.did;
      }
      
      // Ensure the target user exists (stub with DID-based handle to avoid collisions)
      let targetUser = await storage.getUser(mutedDid);
      if (!targetUser) {
        const targetHandle = mutedDid.replace(/[:.]/g, '-') + '-stub';
        try {
          await storage.createUser({
            did: mutedDid,
            handle: targetHandle,
          });
        } catch (error: any) {
          // Tolerate concurrent creation or constraint violations
          if (error?.code !== '23505') throw error;
        }
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
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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
      const viewerDid = (req as any).user?.did || "did:plc:demo"; // TODO: Get from auth session
      
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
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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
      const userDid = "did:plc:demo"; // TODO: Get from auth session
      
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
      
      // Get authenticated user from session
      const userDid = (req as any).user?.did;
      if (!userDid) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
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
}

export const xrpcApi = new XRPCApi();
