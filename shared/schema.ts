import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, index, uniqueIndex, serial, boolean, integer, customType } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Custom type for PostgreSQL tsvector (full-text search)
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// Users table - stores AT Protocol user profiles
export const users = pgTable("users", {
  did: varchar("did", { length: 255 }).primaryKey(),
  handle: varchar("handle", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  avatarUrl: text("avatar_url"),
  bannerUrl: text("banner_url"),
  description: text("description"),
  profileRecord: jsonb("profile_record"),
  pinnedPost: jsonb("pinned_post"), // {uri: string, cid: string} for pinned post
  searchVector: tsvector("search_vector"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  handleIdx: index("idx_users_handle").on(table.handle),
  createdAtIdx: index("idx_users_created_at").on(table.createdAt),
  searchVectorIdx: index("idx_users_search_vector").using("gin", table.searchVector),
}));

// Posts table - stores feed posts
export const posts = pgTable("posts", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  authorDid: varchar("author_did", { length: 255 }).notNull(), // No FK - can reference external users
  text: text("text").notNull(),
  parentUri: varchar("parent_uri", { length: 512 }),
  rootUri: varchar("root_uri", { length: 512 }),
  embed: jsonb("embed"),
  facets: jsonb("facets"), // Rich text facets (links, mentions, hashtags)
  violatesThreadGate: boolean("violates_thread_gate").default(false).notNull(),
  violatesEmbeddingRules: boolean("violates_embedding_rules").default(false).notNull(),
  hasThreadGate: boolean("has_thread_gate").default(false).notNull(),
  hasPostGate: boolean("has_post_gate").default(false).notNull(),
  tags: jsonb("tags").default(sql`'[]'::jsonb`).notNull(),
  searchVector: tsvector("search_vector"),
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  authorIdx: index("idx_posts_author_did").on(table.authorDid),
  indexedAtIdx: index("idx_posts_indexed_at").on(table.indexedAt),
  parentIdx: index("idx_posts_parent_uri").on(table.parentUri),
  rootIdx: index("idx_posts_root_uri").on(table.rootUri),
  searchVectorIdx: index("idx_posts_search_vector").using("gin", table.searchVector),
}));

// Feed items table - tracks different types of content in feeds (posts, reposts, replies)
export const feedItems = pgTable("feed_items", {
  uri: varchar("uri", { length: 512 }).primaryKey(), // URI of the feed item (post or repost)
  postUri: varchar("post_uri", { length: 512 }).notNull(), // URI of the original post
  originatorDid: varchar("originator_did", { length: 255 }).notNull(), // DID of the user who created this feed item
  type: varchar("type", { length: 32 }).notNull(), // 'post', 'repost', 'reply'
  sortAt: timestamp("sort_at").notNull(), // Timestamp for sorting (createdAt for posts, createdAt for reposts)
  cid: varchar("cid", { length: 255 }).notNull(), // CID of the record
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  originatorIdx: index("idx_feed_items_originator").on(table.originatorDid),
  postIdx: index("idx_feed_items_post").on(table.postUri),
  sortAtIdx: index("idx_feed_items_sort_at").on(table.sortAt),
  typeIdx: index("idx_feed_items_type").on(table.type),
  originatorSortIdx: index("idx_feed_items_originator_sort").on(table.originatorDid, table.sortAt),
}));

// Post aggregations table - stores counts for posts
export const postAggregations = pgTable("post_aggregations", {
  postUri: varchar("post_uri", { length: 512 }).primaryKey(),
  likeCount: integer("like_count").default(0).notNull(),
  repostCount: integer("repost_count").default(0).notNull(),
  replyCount: integer("reply_count").default(0).notNull(),
  bookmarkCount: integer("bookmark_count").default(0).notNull(),
  quoteCount: integer("quote_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  likeCountIdx: index("idx_post_aggregations_like_count").on(table.likeCount),
  repostCountIdx: index("idx_post_aggregations_repost_count").on(table.repostCount),
  replyCountIdx: index("idx_post_aggregations_reply_count").on(table.replyCount),
  bookmarkCountIdx: index("idx_post_aggregations_bookmark_count").on(table.bookmarkCount),
  quoteCountIdx: index("idx_post_aggregations_quote_count").on(table.quoteCount),
}));

// Post viewer states table - stores viewer-specific state for posts
export const postViewerStates = pgTable("post_viewer_states", {
  postUri: varchar("post_uri", { length: 512 }).notNull(),
  viewerDid: varchar("viewer_did", { length: 255 }).notNull(),
  likeUri: varchar("like_uri", { length: 512 }),
  repostUri: varchar("repost_uri", { length: 512 }),
  bookmarked: boolean("bookmarked").default(false).notNull(),
  threadMuted: boolean("thread_muted").default(false).notNull(),
  replyDisabled: boolean("reply_disabled").default(false).notNull(),
  embeddingDisabled: boolean("embedding_disabled").default(false).notNull(),
  pinned: boolean("pinned").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  postViewerIdx: uniqueIndex("idx_post_viewer_states_post_viewer").on(table.postUri, table.viewerDid),
  postIdx: index("idx_post_viewer_states_post").on(table.postUri),
  viewerIdx: index("idx_post_viewer_states_viewer").on(table.viewerDid),
}));

// Thread contexts table - stores thread-specific context
export const threadContexts = pgTable("thread_contexts", {
  postUri: varchar("post_uri", { length: 512 }).primaryKey(),
  rootAuthorLikeUri: varchar("root_author_like_uri", { length: 512 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  rootAuthorLikeIdx: index("idx_thread_contexts_root_author_like").on(table.rootAuthorLikeUri),
}));

// Likes table
export const likes = pgTable("likes", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  userDid: varchar("user_did", { length: 255 }).notNull(), // No FK - can reference external users
  postUri: varchar("post_uri", { length: 512 }).notNull(), // No FK - can reference external posts
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_likes_user_did").on(table.userDid),
  postIdx: index("idx_likes_post_uri").on(table.postUri),
  uniqueLike: uniqueIndex("unique_like_user_post").on(table.userDid, table.postUri),
}));

// Reposts table
export const reposts = pgTable("reposts", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  userDid: varchar("user_did", { length: 255 }).notNull(), // No FK - can reference external users
  postUri: varchar("post_uri", { length: 512 }).notNull(), // No FK - can reference external posts
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_reposts_user_did").on(table.userDid),
  postIdx: index("idx_reposts_post_uri").on(table.postUri),
  uniqueRepost: uniqueIndex("unique_repost_user_post").on(table.userDid, table.postUri),
}));

// Bookmarks table (unspecced but widely used by clients)
export const bookmarks = pgTable("bookmarks", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  userDid: varchar("user_did", { length: 255 }).notNull(), // No FK - can reference external users
  postUri: varchar("post_uri", { length: 512 }).notNull(), // No FK - can reference external posts
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_bookmarks_user_did").on(table.userDid),
  postIdx: index("idx_bookmarks_post_uri").on(table.postUri),
  uniqueBookmark: uniqueIndex("unique_bookmark_user_post").on(table.userDid, table.postUri),
}));

// Quotes table - tracks quote posts
export const quotes = pgTable("quotes", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  postUri: varchar("post_uri", { length: 512 }).notNull(), // The quote post URI
  quotedUri: varchar("quoted_uri", { length: 512 }).notNull(), // The URI of the quoted post
  quotedCid: varchar("quoted_cid", { length: 255 }),
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  postIdx: index("idx_quotes_post").on(table.postUri),
  quotedIdx: index("idx_quotes_quoted").on(table.quotedUri),
  uniqueQuote: uniqueIndex("unique_quote_post_quoted").on(table.postUri, table.quotedUri),
}));

// Follows table
export const follows = pgTable("follows", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  followerDid: varchar("follower_did", { length: 255 }).notNull(), // No FK - can reference external users
  followingDid: varchar("following_did", { length: 255 }).notNull(), // No FK - can reference external users
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  followerIdx: index("idx_follows_follower").on(table.followerDid),
  followingIdx: index("idx_follows_following").on(table.followingDid),
  uniqueFollow: uniqueIndex("unique_follow_follower_following").on(table.followerDid, table.followingDid),
}));

// Blocks table
export const blocks = pgTable("blocks", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  blockerDid: varchar("blocker_did", { length: 255 }).notNull(), // No FK - can reference external users
  blockedDid: varchar("blocked_did", { length: 255 }).notNull(), // No FK - can reference external users
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  blockerIdx: index("idx_blocks_blocker").on(table.blockerDid),
  blockedIdx: index("idx_blocks_blocked").on(table.blockedDid),
  uniqueBlock: uniqueIndex("unique_block_blocker_blocked").on(table.blockerDid, table.blockedDid),
}));

// Mutes table - user mutes (soft blocks)
export const mutes = pgTable("mutes", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  muterDid: varchar("muter_did", { length: 255 }).notNull(), // No FK - can reference external users
  mutedDid: varchar("muted_did", { length: 255 }).notNull(), // No FK - can reference external users
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  muterIdx: index("idx_mutes_muter").on(table.muterDid),
  mutedIdx: index("idx_mutes_muted").on(table.mutedDid),
  uniqueMute: uniqueIndex("unique_mute_muter_muted").on(table.muterDid, table.mutedDid),
}));

// List mutes table - muted lists
export const listMutes = pgTable("list_mutes", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  muterDid: varchar("muter_did", { length: 255 }).notNull(), // No FK - can reference external users
  listUri: varchar("list_uri", { length: 512 }).notNull(), // No FK - can reference external lists
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  muterIdx: index("idx_list_mutes_muter").on(table.muterDid),
  listIdx: index("idx_list_mutes_list").on(table.listUri),
  uniqueListMute: uniqueIndex("unique_list_mute").on(table.muterDid, table.listUri),
}));

// List blocks table - blocked lists
export const listBlocks = pgTable("list_blocks", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  blockerDid: varchar("blocker_did", { length: 255 }).notNull(), // No FK - can reference external users
  listUri: varchar("list_uri", { length: 512 }).notNull(), // No FK - can reference external lists
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  blockerIdx: index("idx_list_blocks_blocker").on(table.blockerDid),
  listIdx: index("idx_list_blocks_list").on(table.listUri),
  uniqueListBlock: uniqueIndex("unique_list_block").on(table.blockerDid, table.listUri),
}));

// Thread mutes table - muted threads
export const threadMutes = pgTable("thread_mutes", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  muterDid: varchar("muter_did", { length: 255 }).notNull(), // No FK - can reference external users
  threadRootUri: varchar("thread_root_uri", { length: 512 }).notNull(), // No FK - can reference external posts
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  muterIdx: index("idx_thread_mutes_muter").on(table.muterDid),
  threadIdx: index("idx_thread_mutes_thread").on(table.threadRootUri),
  uniqueThreadMute: uniqueIndex("unique_thread_mute").on(table.muterDid, table.threadRootUri),
}));

// User preferences table - AT Protocol preferences
export const userPreferences = pgTable("user_preferences", {
  userDid: varchar("user_did", { length: 255 }).primaryKey().references(() => users.did, { onDelete: "cascade" }),
  adultContent: boolean("adult_content").default(false).notNull(),
  contentLabels: jsonb("content_labels").default({}).notNull(), // {nsfw: 'hide', gore: 'warn', ...}
  feedViewPrefs: jsonb("feed_view_prefs").default({}).notNull(), // {hideReplies: false, hideReposts: false, ...}
  threadViewPrefs: jsonb("thread_view_prefs").default({}).notNull(),
  interests: jsonb("interests").default([]).notNull(), // Array of interest tags
  savedFeeds: jsonb("saved_feeds").default([]).notNull(), // savedFeedsPrefV2 items
  notificationPriority: boolean("notification_priority").default(false).notNull(), // Push notification priority
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});


// Sessions table - for OAuth 2.0 authentication
export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userDid: varchar("user_did", { length: 255 }).notNull().references(() => users.did, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  pdsEndpoint: varchar("pds_endpoint", { length: 512 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_sessions_user_did").on(table.userDid),
  expiresIdx: index("idx_sessions_expires_at").on(table.expiresAt),
}));

// OAuth states table - for persisting OAuth state parameters across restarts
export const oauthStates = pgTable("oauth_states", {
  state: varchar("state", { length: 255 }).primaryKey(),
  stateData: jsonb("state_data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
  expiresAtIdx: index("idx_oauth_states_expires_at").on(table.expiresAt),
}));

// Authorized admins table - stores DIDs of users authorized to access admin panel
export const authorizedAdmins = pgTable("authorized_admins", {
  did: varchar("did", { length: 255 }).primaryKey(),
  handle: varchar("handle", { length: 255 }).notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => ({
  handleIdx: index("idx_authorized_admins_handle").on(table.handle),
}));

// User settings table - for custom preferences and moderation
export const userSettings = pgTable("user_settings", {
  userDid: varchar("user_did", { length: 255 }).primaryKey().references(() => users.did, { onDelete: "cascade" }),
  blockedKeywords: jsonb("blocked_keywords").default([]).notNull(),
  mutedUsers: jsonb("muted_users").default([]).notNull(),
  customLists: jsonb("custom_lists").default([]).notNull(),
  feedPreferences: jsonb("feed_preferences").default({}).notNull(),
  dataCollectionForbidden: boolean("data_collection_forbidden").default(false).notNull(),
  lastBackfillAt: timestamp("last_backfill_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Labels table - AT Protocol content labels
export const labels = pgTable("labels", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  src: varchar("src", { length: 255 }).notNull(), // DID of the labeler
  subject: varchar("subject", { length: 512 }).notNull(), // URI or DID being labeled
  val: varchar("val", { length: 128 }).notNull(), // Label value (spam, nsfw, etc)
  neg: boolean("neg").default(false).notNull(), // Negation flag
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  subjectIdx: index("idx_labels_subject").on(table.subject),
  srcIdx: index("idx_labels_src").on(table.src),
  valIdx: index("idx_labels_val").on(table.val),
  subjectValIdx: index("idx_labels_subject_val").on(table.subject, table.val),
}));

// Label definitions table - custom label type definitions
export const labelDefinitions = pgTable("label_definitions", {
  id: serial("id").primaryKey(),
  value: varchar("value", { length: 128 }).notNull().unique(),
  description: text("description"),
  severity: varchar("severity", { length: 32 }).default("warn").notNull(), // info, warn, alert, none
  localizedStrings: jsonb("localized_strings").default({}), // {en: {name, description}, ...}
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Label events table - for WebSocket subscriptions
export const labelEvents = pgTable("label_events", {
  id: serial("id").primaryKey(),
  labelUri: varchar("label_uri", { length: 512 }).notNull().references(() => labels.uri, { onDelete: "cascade" }),
  action: varchar("action", { length: 32 }).notNull(), // created, deleted
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index("idx_label_events_created_at").on(table.createdAt),
  labelUriIdx: index("idx_label_events_label_uri").on(table.labelUri),
}));

// Moderation reports table - user-submitted reports
export const moderationReports = pgTable("moderation_reports", {
  id: serial("id").primaryKey(),
  subject: varchar("subject", { length: 512 }).notNull(), // URI or DID being reported
  subjectType: varchar("subject_type", { length: 32 }).notNull(), // post, account, message
  reportType: varchar("report_type", { length: 64 }).notNull(), // spam, violation, misleading, sexual, rude, other
  reason: text("reason"), // Additional context from reporter
  reporterDid: varchar("reporter_did", { length: 255 }).notNull(), // DID of user submitting report
  status: varchar("status", { length: 32 }).default("pending").notNull(), // pending, under_review, resolved, dismissed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  subjectIdx: index("idx_moderation_reports_subject").on(table.subject),
  reporterIdx: index("idx_moderation_reports_reporter").on(table.reporterDid),
  statusIdx: index("idx_moderation_reports_status").on(table.status),
  createdAtIdx: index("idx_moderation_reports_created_at").on(table.createdAt),
}));

// Moderation actions table - actions taken on reports
export const moderationActions = pgTable("moderation_actions", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => moderationReports.id, { onDelete: "cascade" }),
  actionType: varchar("action_type", { length: 64 }).notNull(), // label_applied, content_removed, account_suspended, dismissed, escalated
  moderatorDid: varchar("moderator_did", { length: 255 }).notNull(), // DID of moderator
  resolutionNotes: text("resolution_notes"), // Moderator's notes
  labelUri: varchar("label_uri", { length: 512 }), // Optional: label applied as part of action
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  reportIdx: index("idx_moderation_actions_report").on(table.reportId),
  moderatorIdx: index("idx_moderation_actions_moderator").on(table.moderatorDid),
  createdAtIdx: index("idx_moderation_actions_created_at").on(table.createdAt),
}));

// Moderator assignments table - report queue assignments
export const moderatorAssignments = pgTable("moderator_assignments", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull().references(() => moderationReports.id, { onDelete: "cascade" }),
  moderatorDid: varchar("moderator_did", { length: 255 }).notNull(), // DID of assigned moderator
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"), // Nullable until completed
}, (table) => ({
  reportIdx: index("idx_moderator_assignments_report").on(table.reportId),
  moderatorIdx: index("idx_moderator_assignments_moderator").on(table.moderatorDid),
  uniqueAssignment: uniqueIndex("unique_assignment_report_moderator").on(table.reportId, table.moderatorDid),
}));

// Notifications table - user notifications for interactions
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  uri: varchar("uri", { length: 512 }).notNull().unique(),
  recipientDid: varchar("recipient_did", { length: 255 }).notNull(), // No FK - can reference external users
  authorDid: varchar("author_did", { length: 255 }).notNull(), // No FK - can reference external users
  reason: varchar("reason", { length: 64 }).notNull(), // like, repost, follow, reply, mention, quote
  reasonSubject: varchar("reason_subject", { length: 512 }), // URI of the post/subject
  cid: varchar("cid", { length: 255 }), // CID of the record that caused the notification
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  recipientIdx: index("idx_notifications_recipient").on(table.recipientDid),
  recipientReadIdx: index("idx_notifications_recipient_read").on(table.recipientDid, table.isRead),
  createdAtIdx: index("idx_notifications_created_at").on(table.createdAt),
  indexedAtIdx: index("idx_notifications_indexed_at").on(table.indexedAt),
}));

// Activity subscriptions table - per-actor notification preferences
export const activitySubscriptions = pgTable("activity_subscriptions", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  subscriberDid: varchar("subscriber_did", { length: 255 }).notNull(), // No FK - user subscribing
  subjectDid: varchar("subject_did", { length: 255 }).notNull(), // No FK - user being subscribed to
  priority: boolean("priority").default(false).notNull(), // Priority notifications flag
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  subscriberIdx: index("idx_activity_subscriptions_subscriber").on(table.subscriberDid),
  subjectIdx: index("idx_activity_subscriptions_subject").on(table.subjectDid),
  uniqueSubscription: uniqueIndex("unique_activity_subscription").on(table.subscriberDid, table.subjectDid),
}));

// Lists table - curated user lists
export const lists = pgTable("lists", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  creatorDid: varchar("creator_did", { length: 255 }).notNull(), // No FK - can reference external users
  name: varchar("name", { length: 255 }).notNull(),
  purpose: varchar("purpose", { length: 64 }).notNull(), // app.bsky.graph.defs#curatelist, app.bsky.graph.defs#modlist
  description: text("description"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  creatorIdx: index("idx_lists_creator").on(table.creatorDid),
  purposeIdx: index("idx_lists_purpose").on(table.purpose),
  indexedAtIdx: index("idx_lists_indexed_at").on(table.indexedAt),
}));

// List items table - members of lists
export const listItems = pgTable("list_items", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  listUri: varchar("list_uri", { length: 512 }).notNull(), // No FK - can reference external lists
  subjectDid: varchar("subject_did", { length: 255 }).notNull(), // No FK - can reference external users
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  listIdx: index("idx_list_items_list").on(table.listUri),
  subjectIdx: index("idx_list_items_subject").on(table.subjectDid),
  uniqueListItem: uniqueIndex("unique_list_item").on(table.listUri, table.subjectDid),
}));

// Feed generators table - custom algorithmic feeds
export const feedGenerators = pgTable("feed_generators", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  creatorDid: varchar("creator_did", { length: 255 }).notNull(), // No FK - can reference external users
  did: varchar("did", { length: 255 }).notNull(), // Service DID that hosts the feed
  displayName: varchar("display_name", { length: 255 }).notNull(),
  description: text("description"),
  avatarUrl: text("avatar_url"),
  likeCount: integer("like_count").default(0).notNull(),
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  creatorIdx: index("idx_feed_generators_creator").on(table.creatorDid),
  didIdx: index("idx_feed_generators_did").on(table.did),
  likeCountIdx: index("idx_feed_generators_like_count").on(table.likeCount),
  indexedAtIdx: index("idx_feed_generators_indexed_at").on(table.indexedAt),
}));

// Starter packs table - curated onboarding packs
export const starterPacks = pgTable("starter_packs", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  creatorDid: varchar("creator_did", { length: 255 }).notNull(), // No FK - can reference external users
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  listUri: varchar("list_uri", { length: 512 }), // No FK - can reference external lists
  feeds: jsonb("feeds").default(sql`'[]'::jsonb`).notNull(), // Array of feed generator URIs
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  creatorIdx: index("idx_starter_packs_creator").on(table.creatorDid),
  listIdx: index("idx_starter_packs_list").on(table.listUri),
  indexedAtIdx: index("idx_starter_packs_indexed_at").on(table.indexedAt),
}));

// Labeler services table - moderation labeler services
export const labelerServices = pgTable("labeler_services", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  creatorDid: varchar("creator_did", { length: 255 }).notNull(), // No FK - can reference external users
  policies: jsonb("policies").notNull(), // Label values and label value definitions
  likeCount: integer("like_count").default(0).notNull(),
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  creatorIdx: index("idx_labeler_services_creator").on(table.creatorDid),
  likeCountIdx: index("idx_labeler_services_like_count").on(table.likeCount),
  indexedAtIdx: index("idx_labeler_services_indexed_at").on(table.indexedAt),
}));

// Verifications table - handle verification records
export const verifications = pgTable("verifications", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  subjectDid: varchar("subject_did", { length: 255 }).notNull(), // No FK - can reference external users
  handle: varchar("handle", { length: 255 }).notNull(),
  verifiedAt: timestamp("verified_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  subjectIdx: index("idx_verifications_subject").on(table.subjectDid),
  handleIdx: index("idx_verifications_handle").on(table.handle),
  uniqueVerification: uniqueIndex("unique_verification_subject").on(table.subjectDid),
}));

// Push subscriptions table - device push notification registrations
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userDid: varchar("user_did", { length: 255 }).notNull().references(() => users.did, { onDelete: "cascade" }),
  platform: varchar("platform", { length: 32 }).notNull(), // ios, android, web
  token: text("token").notNull(), // FCM/APNs device token
  endpoint: text("endpoint"), // For web push
  keys: jsonb("keys"), // For web push (p256dh, auth)
  appId: varchar("app_id", { length: 255 }), // Optional app identifier
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("idx_push_subscriptions_user").on(table.userDid),
  tokenIdx: uniqueIndex("idx_push_subscriptions_token").on(table.token),
  platformIdx: index("idx_push_subscriptions_platform").on(table.platform),
}));

// Video jobs table - video processing status
export const videoJobs = pgTable("video_jobs", {
  id: serial("id").primaryKey(),
  jobId: varchar("job_id", { length: 255 }).notNull().unique(), // External job identifier
  userDid: varchar("user_did", { length: 255 }).notNull().references(() => users.did, { onDelete: "cascade" }),
  state: varchar("state", { length: 32 }).notNull(), // JOB_STATE_CREATED, JOB_STATE_PROCESSING, JOB_STATE_COMPLETED, JOB_STATE_FAILED
  progress: integer("progress").default(0).notNull(), // 0-100
  blobRef: jsonb("blob_ref"), // Reference to uploaded blob {cid, mimeType}
  error: text("error"), // Error message if failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  jobIdIdx: uniqueIndex("idx_video_jobs_job_id").on(table.jobId),
  userIdx: index("idx_video_jobs_user").on(table.userDid),
  stateIdx: index("idx_video_jobs_state").on(table.state),
  createdAtIdx: index("idx_video_jobs_created_at").on(table.createdAt),
}));

// Firehose cursor state table - tracks position in the firehose for restart recovery
export const firehoseCursor = pgTable("firehose_cursor", {
  id: serial("id").primaryKey(),
  service: varchar("service", { length: 255 }).notNull().unique(), // "firehose" - allows multiple services in future
  cursor: text("cursor"), // Current cursor position in the firehose
  lastEventTime: timestamp("last_event_time"), // Timestamp of last processed event
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  serviceIdx: uniqueIndex("idx_firehose_cursor_service").on(table.service),
}));

// Generic records table - stores custom/unknown record types
export const genericRecords = pgTable("generic_records", {
  uri: varchar("uri", { length: 512 }).primaryKey(),
  cid: varchar("cid", { length: 255 }).notNull(),
  authorDid: varchar("author_did", { length: 255 }).notNull(),
  recordType: varchar("record_type", { length: 255 }).notNull(), // Full record type (e.g., com.whtwnd.blog.entry)
  record: jsonb("record").notNull(), // The full record data
  createdAt: timestamp("created_at").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow().notNull(),
}, (table) => ({
  authorIdx: index("idx_generic_records_author").on(table.authorDid),
  recordTypeIdx: index("idx_generic_records_type").on(table.recordType),
  createdAtIdx: index("idx_generic_records_created_at").on(table.createdAt),
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  likes: many(likes),
  reposts: many(reposts),
  following: many(follows, { relationName: "follower" }),
  followers: many(follows, { relationName: "following" }),
  blocking: many(blocks, { relationName: "blocker" }),
  blockedBy: many(blocks, { relationName: "blocked" }),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorDid], references: [users.did] }),
  likes: many(likes),
  reposts: many(reposts),
  feedItems: many(feedItems),
}));

export const feedItemsRelations = relations(feedItems, ({ one }) => ({
  post: one(posts, { fields: [feedItems.postUri], references: [posts.uri] }),
  originator: one(users, { fields: [feedItems.originatorDid], references: [users.did] }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(users, { fields: [likes.userDid], references: [users.did] }),
  post: one(posts, { fields: [likes.postUri], references: [posts.uri] }),
}));

export const repostsRelations = relations(reposts, ({ one }) => ({
  user: one(users, { fields: [reposts.userDid], references: [users.did] }),
  post: one(posts, { fields: [reposts.postUri], references: [posts.uri] }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, { fields: [follows.followerDid], references: [users.did], relationName: "follower" }),
  following: one(users, { fields: [follows.followingDid], references: [users.did], relationName: "following" }),
}));

export const blocksRelations = relations(blocks, ({ one }) => ({
  blocker: one(users, { fields: [blocks.blockerDid], references: [users.did], relationName: "blocker" }),
  blocked: one(users, { fields: [blocks.blockedDid], references: [users.did], relationName: "blocked" }),
}));

export const mutesRelations = relations(mutes, ({ one }) => ({
  muter: one(users, { fields: [mutes.muterDid], references: [users.did], relationName: "muter" }),
  muted: one(users, { fields: [mutes.mutedDid], references: [users.did], relationName: "muted" }),
}));

export const listMutesRelations = relations(listMutes, ({ one }) => ({
  muter: one(users, { fields: [listMutes.muterDid], references: [users.did] }),
  list: one(lists, { fields: [listMutes.listUri], references: [lists.uri] }),
}));

export const listBlocksRelations = relations(listBlocks, ({ one }) => ({
  blocker: one(users, { fields: [listBlocks.blockerDid], references: [users.did] }),
  list: one(lists, { fields: [listBlocks.listUri], references: [lists.uri] }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, { fields: [userPreferences.userDid], references: [users.did] }),
}));


export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userDid], references: [users.did] }),
}));

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(users, { fields: [userSettings.userDid], references: [users.did] }),
}));

export const labelsRelations = relations(labels, ({ many }) => ({
  events: many(labelEvents),
}));

export const labelEventsRelations = relations(labelEvents, ({ one }) => ({
  label: one(labels, { fields: [labelEvents.labelUri], references: [labels.uri] }),
}));

export const moderationReportsRelations = relations(moderationReports, ({ many }) => ({
  actions: many(moderationActions),
  assignments: many(moderatorAssignments),
}));

export const moderationActionsRelations = relations(moderationActions, ({ one }) => ({
  report: one(moderationReports, { fields: [moderationActions.reportId], references: [moderationReports.id] }),
}));

export const moderatorAssignmentsRelations = relations(moderatorAssignments, ({ one }) => ({
  report: one(moderationReports, { fields: [moderatorAssignments.reportId], references: [moderationReports.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, { fields: [notifications.recipientDid], references: [users.did], relationName: "notificationsReceived" }),
  author: one(users, { fields: [notifications.authorDid], references: [users.did], relationName: "notificationsSent" }),
}));

export const listsRelations = relations(lists, ({ one, many }) => ({
  creator: one(users, { fields: [lists.creatorDid], references: [users.did] }),
  items: many(listItems),
}));

export const listItemsRelations = relations(listItems, ({ one }) => ({
  list: one(lists, { fields: [listItems.listUri], references: [lists.uri] }),
  subject: one(users, { fields: [listItems.subjectDid], references: [users.did] }),
}));

export const feedGeneratorsRelations = relations(feedGenerators, ({ one }) => ({
  creator: one(users, { fields: [feedGenerators.creatorDid], references: [users.did] }),
}));

export const starterPacksRelations = relations(starterPacks, ({ one }) => ({
  creator: one(users, { fields: [starterPacks.creatorDid], references: [users.did] }),
  list: one(lists, { fields: [starterPacks.listUri], references: [lists.uri] }),
}));

export const labelerServicesRelations = relations(labelerServices, ({ one }) => ({
  creator: one(users, { fields: [labelerServices.creatorDid], references: [users.did] }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ createdAt: true, indexedAt: true });
export const insertPostSchema = createInsertSchema(posts).omit({ indexedAt: true });
export const insertFeedItemSchema = createInsertSchema(feedItems).omit({ indexedAt: true });
export const insertLikeSchema = createInsertSchema(likes).omit({ indexedAt: true });
export const insertRepostSchema = createInsertSchema(reposts).omit({ indexedAt: true });
export const insertFollowSchema = createInsertSchema(follows).omit({ indexedAt: true });
export const insertBlockSchema = createInsertSchema(blocks).omit({ indexedAt: true });
export const insertMuteSchema = createInsertSchema(mutes).omit({ indexedAt: true });
export const insertListMuteSchema = createInsertSchema(listMutes).omit({ indexedAt: true });
export const insertListBlockSchema = createInsertSchema(listBlocks).omit({ indexedAt: true });
export const insertThreadMuteSchema = createInsertSchema(threadMutes).omit({ indexedAt: true });
export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({ createdAt: true, updatedAt: true });
export const insertSessionSchema = createInsertSchema(sessions).omit({ createdAt: true, updatedAt: true });
export const insertAuthorizedAdminSchema = createInsertSchema(authorizedAdmins).omit({ addedAt: true });
export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({ createdAt: true, updatedAt: true });
export const insertLabelSchema = createInsertSchema(labels).omit({ indexedAt: true });
export const insertLabelDefinitionSchema = createInsertSchema(labelDefinitions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLabelEventSchema = createInsertSchema(labelEvents).omit({ id: true, createdAt: true });
export const insertModerationReportSchema = createInsertSchema(moderationReports).omit({ id: true, createdAt: true, updatedAt: true });
export const insertModerationActionSchema = createInsertSchema(moderationActions).omit({ id: true, createdAt: true });
export const insertModeratorAssignmentSchema = createInsertSchema(moderatorAssignments).omit({ id: true, assignedAt: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, indexedAt: true });
export const insertListSchema = createInsertSchema(lists).omit({ indexedAt: true });
export const insertListItemSchema = createInsertSchema(listItems).omit({ indexedAt: true });
export const insertFeedGeneratorSchema = createInsertSchema(feedGenerators).omit({ indexedAt: true, likeCount: true });
export const insertStarterPackSchema = createInsertSchema(starterPacks).omit({ indexedAt: true });
export const insertLabelerServiceSchema = createInsertSchema(labelerServices).omit({ indexedAt: true, likeCount: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVideoJobSchema = createInsertSchema(videoJobs).omit({ id: true, createdAt: true, updatedAt: true });
// Bookmark insert schema/types
export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ indexedAt: true });
export const insertQuoteSchema = createInsertSchema(quotes).omit({ indexedAt: true });
export const insertVerificationSchema = createInsertSchema(verifications).omit({ indexedAt: true });
export const insertActivitySubscriptionSchema = createInsertSchema(activitySubscriptions).omit({ indexedAt: true });
export const insertFirehoseCursorSchema = createInsertSchema(firehoseCursor).omit({ id: true, updatedAt: true });
export const insertGenericRecordSchema = createInsertSchema(genericRecords).omit({ indexedAt: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Post = typeof posts.$inferSelect;
export type InsertPost = z.infer<typeof insertPostSchema>;
export type FeedItem = typeof feedItems.$inferSelect;
export type InsertFeedItem = z.infer<typeof insertFeedItemSchema>;
export type Like = typeof likes.$inferSelect;
export type InsertLike = z.infer<typeof insertLikeSchema>;
export type Repost = typeof reposts.$inferSelect;
export type InsertRepost = z.infer<typeof insertRepostSchema>;
export type Follow = typeof follows.$inferSelect;
export type InsertFollow = z.infer<typeof insertFollowSchema>;
export type Block = typeof blocks.$inferSelect;
export type InsertBlock = z.infer<typeof insertBlockSchema>;
export type Mute = typeof mutes.$inferSelect;
export type InsertMute = z.infer<typeof insertMuteSchema>;
export type ListMute = typeof listMutes.$inferSelect;
export type InsertListMute = z.infer<typeof insertListMuteSchema>;
export type ListBlock = typeof listBlocks.$inferSelect;
export type InsertListBlock = z.infer<typeof insertListBlockSchema>;
export type ThreadMute = typeof threadMutes.$inferSelect;
export type InsertThreadMute = z.infer<typeof insertThreadMuteSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type AuthorizedAdmin = typeof authorizedAdmins.$inferSelect;
export type InsertAuthorizedAdmin = z.infer<typeof insertAuthorizedAdminSchema>;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type Label = typeof labels.$inferSelect;
export type InsertLabel = z.infer<typeof insertLabelSchema>;
export type LabelDefinition = typeof labelDefinitions.$inferSelect;
export type InsertLabelDefinition = z.infer<typeof insertLabelDefinitionSchema>;
export type LabelEvent = typeof labelEvents.$inferSelect;
export type InsertLabelEvent = z.infer<typeof insertLabelEventSchema>;
export type ModerationReport = typeof moderationReports.$inferSelect;
export type InsertModerationReport = z.infer<typeof insertModerationReportSchema>;
export type ModerationAction = typeof moderationActions.$inferSelect;
export type InsertModerationAction = z.infer<typeof insertModerationActionSchema>;
export type ModeratorAssignment = typeof moderatorAssignments.$inferSelect;
export type InsertModeratorAssignment = z.infer<typeof insertModeratorAssignmentSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type List = typeof lists.$inferSelect;
export type InsertList = z.infer<typeof insertListSchema>;
export type ListItem = typeof listItems.$inferSelect;
export type InsertListItem = z.infer<typeof insertListItemSchema>;
export type FeedGenerator = typeof feedGenerators.$inferSelect;
export type InsertFeedGenerator = z.infer<typeof insertFeedGeneratorSchema>;
export type StarterPack = typeof starterPacks.$inferSelect;
export type InsertStarterPack = z.infer<typeof insertStarterPackSchema>;
export type LabelerService = typeof labelerServices.$inferSelect;
export type InsertLabelerService = z.infer<typeof insertLabelerServiceSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type VideoJob = typeof videoJobs.$inferSelect;
export type Bookmark = typeof bookmarks.$inferSelect;
export type InsertVideoJob = z.infer<typeof insertVideoJobSchema>;
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Quote = typeof quotes.$inferSelect;
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Verification = typeof verifications.$inferSelect;
export type InsertVerification = z.infer<typeof insertVerificationSchema>;
export type ActivitySubscription = typeof activitySubscriptions.$inferSelect;
export type InsertActivitySubscription = z.infer<typeof insertActivitySubscriptionSchema>;
export type FirehoseCursor = typeof firehoseCursor.$inferSelect;
export type InsertFirehoseCursor = z.infer<typeof insertFirehoseCursorSchema>;
export type GenericRecord = typeof genericRecords.$inferSelect;
export type InsertGenericRecord = z.infer<typeof insertGenericRecordSchema>;
