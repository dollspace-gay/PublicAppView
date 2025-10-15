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
