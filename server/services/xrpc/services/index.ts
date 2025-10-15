/**
 * XRPC Services Index
 * Centralized export of all service modules
 */

// Bookmark Service
export {
  createBookmark,
  deleteBookmark,
  getBookmarks,
} from './bookmark-service';

// Search Service
export {
  searchPosts,
  searchActors,
  searchActorsTypeahead,
  searchStarterPacks,
} from './search-service';

// Utility Service
export {
  getServices,
  getJobStatus,
  getUploadLimits,
  sendInteractions,
} from './utility-service';

// Preferences Service
export { getPreferences, putPreferences } from './preferences-service';

// Notification Service
export {
  listNotifications,
  getUnreadCount,
  updateSeen,
  getNotificationPreferences,
  putNotificationPreferences,
  putNotificationPreferencesV2,
  listActivitySubscriptions,
  putActivitySubscription,
} from './notification-service';

// Starter Pack Service
export {
  getStarterPack,
  getStarterPacks,
  getActorStarterPacks,
  getStarterPacksWithMembership,
  getOnboardingSuggestedStarterPacks,
} from './starter-pack-service';

// Push Notification Service
export { registerPush, unregisterPush } from './push-notification-service';

// Feed Generator Service
export {
  getFeedGenerator,
  getFeedGenerators,
  getActorFeeds,
  getSuggestedFeeds,
  describeFeedGenerator,
  getPopularFeedGenerators,
  getSuggestedFeedsUnspecced,
} from './feed-generator-service';

// List Service
export {
  getList,
  getLists,
  getListFeed,
  getListsWithMembership,
  getListMutes,
  getListBlocks,
} from './list-service';

// Graph Service
export {
  getRelationships,
  getKnownFollowers,
  getFollows,
  getFollowers,
} from './graph-service';

// Timeline Service
export {
  getTimeline,
  getAuthorFeed,
  getPostThread,
  getFeed,
  getPostThreadV2,
  getPostThreadOtherV2,
} from './timeline-service';

// Actor/Profile Service
export {
  getProfile,
  getProfiles,
  getSuggestions,
  getSuggestedFollowsByActor,
  getSuggestedUsersUnspecced,
} from './actor-service';

// Moderation Service
export {
  getBlocks,
  getMutes,
  muteActor,
  unmuteActor,
  muteActorList,
  unmuteActorList,
  muteThread,
  unmuteThread,
  queryLabels,
  createReport,
} from './moderation-service';

// Unspecced Service
export {
  getTaggedSuggestions,
  getTrendingTopics,
  getTrends,
  getUnspeccedConfig,
  getAgeAssuranceState,
  initAgeAssurance,
} from './unspecced-service';
