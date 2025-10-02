import type { Request, Response } from "express";
import { storage } from "../storage";
import { contentFilter } from "./content-filter";
import { feedAlgorithm } from "./feed-algorithm";
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
  reasonType: z.enum(["spam", "violation", "misleading", "sexual", "rude", "other"]),
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

export class XRPCApi {
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
}

export const xrpcApi = new XRPCApi();
