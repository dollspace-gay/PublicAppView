/**
 * XRPC Schemas Index
 * Centralized export of all Zod validation schemas organized by domain
 */

// Timeline & Post Schemas
export {
  getTimelineSchema,
  getAuthorFeedSchema,
  getPostThreadSchema,
  getPostsSchema,
  getLikesSchema,
  getRepostedBySchema,
  getQuotesSchema,
  getActorLikesSchema,
  getPostThreadV2Schema,
  getPostThreadOtherV2Schema,
} from './timeline-schemas';

// Actor/Profile Schemas
export {
  getProfileSchema,
  getProfilesSchema,
  getFollowsSchema,
  getSuggestionsSchema,
  getSuggestedFollowsByActorSchema,
  searchActorsSchema,
  searchActorsTypeaheadSchema,
  suggestedUsersUnspeccedSchema,
} from './actor-schemas';

// Moderation Schemas
export {
  getMutesSchema,
  muteActorSchema,
  getBlocksSchema,
  getListMutesSchema,
  getListBlocksSchema,
  muteActorListSchema,
  unmuteActorListSchema,
  muteThreadSchema,
  queryLabelsSchema,
  createReportSchema,
} from './moderation-schemas';

// Social Graph Schemas
export {
  getRelationshipsSchema,
  getKnownFollowersSchema,
} from './graph-schemas';

// List Schemas
export {
  getListSchema,
  getListsSchema,
  getListFeedSchema,
  getListsWithMembershipSchema,
} from './list-schemas';

// Preferences Schemas
export { putActorPreferencesSchema } from './preferences-schemas';

// Notification Schemas
export {
  listNotificationsSchema,
  getUnreadCountSchema,
  updateSeenSchema,
  registerPushSchema,
  unregisterPushSchema,
  getNotificationPreferencesSchema,
  putNotificationPreferencesSchema,
  putNotificationPreferencesV2Schema,
  getNotificationPreferencesV2Schema,
  listActivitySubscriptionsSchema,
  putActivitySubscriptionSchema,
} from './notification-schemas';

// Feed Generator Schemas
export {
  getFeedSchema,
  getFeedGeneratorSchema,
  getFeedGeneratorsSchema,
  getActorFeedsSchema,
  getSuggestedFeedsSchema,
  getPopularFeedGeneratorsSchema,
  describeFeedGeneratorSchema,
  getSuggestedFeedsUnspeccedSchema,
} from './feed-generator-schemas';

// Starter Pack Schemas
export {
  getStarterPackSchema,
  getStarterPacksSchema,
  getActorStarterPacksSchema,
  getStarterPacksWithMembershipSchema,
  searchStarterPacksSchema,
  getOnboardingSuggestedStarterPacksSchema,
} from './starter-pack-schemas';

// Search Schemas
export { searchPostsSchema } from './search-schemas';

// Utility Schemas
export {
  getLabelerServicesSchema,
  getJobStatusSchema,
  sendInteractionsSchema,
  unspeccedNoParamsSchema,
  getTrendsSchema,
} from './utility-schemas';
