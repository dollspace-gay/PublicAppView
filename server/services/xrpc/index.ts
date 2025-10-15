/**
 * XRPC Orchestrator/Facade
 *
 * Provides a unified interface for all XRPC endpoints.
 * Delegates to extracted service modules where available,
 * falls back to original XRPCApi for not-yet-extracted endpoints.
 *
 * This allows progressive migration from monolithic to modular architecture
 * without breaking existing code.
 */

import type { Request, Response } from 'express';
import { xrpcApi } from '../xrpc-api';

// Import extracted services
import * as bookmarkService from './services/bookmark-service';
import * as searchService from './services/search-service';
import * as utilityService from './services/utility-service';
import * as preferencesService from './services/preferences-service';
import * as notificationService from './services/notification-service';
import * as starterPackService from './services/starter-pack-service';
import * as pushNotificationService from './services/push-notification-service';
import * as feedGeneratorService from './services/feed-generator-service';
import * as listService from './services/list-service';
import * as graphService from './services/graph-service';
import * as timelineService from './services/timeline-service';
import * as actorService from './services/actor-service';
import * as moderationService from './services/moderation-service';
import * as unspeccedService from './services/unspecced-service';
import * as postInteractionService from './services/post-interaction-service';

/**
 * XRPC Orchestrator Class
 *
 * Maintains the same interface as the original XRPCApi class
 * but delegates to modular services where possible.
 */
export class XRPCOrchestrator {
  // Original instance for fallback to non-extracted endpoints
  private legacy = xrpcApi;

  // ============================================================================
  // EXTRACTED SERVICES (Phase 3)
  // These delegate to new modular service files
  // ============================================================================

  // Bookmark Service (3 endpoints)
  async createBookmark(req: Request, res: Response): Promise<void> {
    return bookmarkService.createBookmark(req, res);
  }

  async deleteBookmark(req: Request, res: Response): Promise<void> {
    return bookmarkService.deleteBookmark(req, res);
  }

  async getBookmarks(req: Request, res: Response): Promise<void> {
    return bookmarkService.getBookmarks(req, res);
  }

  // Search Service (4 endpoints)
  async searchPosts(req: Request, res: Response): Promise<void> {
    return searchService.searchPosts(req, res);
  }

  async searchActors(req: Request, res: Response): Promise<void> {
    return searchService.searchActors(req, res);
  }

  async searchActorsTypeahead(req: Request, res: Response): Promise<void> {
    return searchService.searchActorsTypeahead(req, res);
  }

  async searchStarterPacks(req: Request, res: Response): Promise<void> {
    return searchService.searchStarterPacks(req, res);
  }

  // Utility Service (4 endpoints)
  async getServices(req: Request, res: Response): Promise<void> {
    return utilityService.getServices(req, res);
  }

  async getJobStatus(req: Request, res: Response): Promise<void> {
    return utilityService.getJobStatus(req, res);
  }

  async getUploadLimits(req: Request, res: Response): Promise<void> {
    return utilityService.getUploadLimits(req, res);
  }

  async sendInteractions(req: Request, res: Response): Promise<void> {
    return utilityService.sendInteractions(req, res);
  }

  // Preferences Service (2 endpoints)
  async getPreferences(req: Request, res: Response): Promise<void> {
    return preferencesService.getPreferences(req, res);
  }

  async putPreferences(req: Request, res: Response): Promise<void> {
    return preferencesService.putPreferences(req, res);
  }

  // Notification Service (8 endpoints)
  async listNotifications(req: Request, res: Response): Promise<void> {
    return notificationService.listNotifications(req, res);
  }

  async getUnreadCount(req: Request, res: Response): Promise<void> {
    return notificationService.getUnreadCount(req, res);
  }

  async updateSeen(req: Request, res: Response): Promise<void> {
    return notificationService.updateSeen(req, res);
  }

  async updateNotificationSeen(req: Request, res: Response): Promise<void> {
    return notificationService.updateSeen(req, res);
  }

  async getNotificationPreferences(req: Request, res: Response): Promise<void> {
    return notificationService.getNotificationPreferences(req, res);
  }

  async putNotificationPreferences(req: Request, res: Response): Promise<void> {
    return notificationService.putNotificationPreferences(req, res);
  }

  async putNotificationPreferencesV2(
    req: Request,
    res: Response
  ): Promise<void> {
    return notificationService.putNotificationPreferencesV2(req, res);
  }

  async listActivitySubscriptions(req: Request, res: Response): Promise<void> {
    return notificationService.listActivitySubscriptions(req, res);
  }

  async putActivitySubscription(req: Request, res: Response): Promise<void> {
    return notificationService.putActivitySubscription(req, res);
  }

  // Starter Pack Service (5 endpoints)
  async getStarterPack(req: Request, res: Response): Promise<void> {
    return starterPackService.getStarterPack(req, res);
  }

  async getStarterPacks(req: Request, res: Response): Promise<void> {
    return starterPackService.getStarterPacks(req, res);
  }

  async getActorStarterPacks(req: Request, res: Response): Promise<void> {
    return starterPackService.getActorStarterPacks(req, res);
  }

  async getStarterPacksWithMembership(
    req: Request,
    res: Response
  ): Promise<void> {
    return starterPackService.getStarterPacksWithMembership(req, res);
  }

  async getOnboardingSuggestedStarterPacks(
    req: Request,
    res: Response
  ): Promise<void> {
    return starterPackService.getOnboardingSuggestedStarterPacks(req, res);
  }

  // Push Notification Service (2 endpoints)
  async registerPush(req: Request, res: Response): Promise<void> {
    return pushNotificationService.registerPush(req, res);
  }

  async unregisterPush(req: Request, res: Response): Promise<void> {
    return pushNotificationService.unregisterPush(req, res);
  }

  // Feed Generator Service (7 endpoints)
  async getFeedGenerator(req: Request, res: Response): Promise<void> {
    return feedGeneratorService.getFeedGenerator(req, res);
  }

  async getFeedGenerators(req: Request, res: Response): Promise<void> {
    return feedGeneratorService.getFeedGenerators(req, res);
  }

  async getActorFeeds(req: Request, res: Response): Promise<void> {
    return feedGeneratorService.getActorFeeds(req, res);
  }

  async getSuggestedFeeds(req: Request, res: Response): Promise<void> {
    return feedGeneratorService.getSuggestedFeeds(req, res);
  }

  async describeFeedGenerator(req: Request, res: Response): Promise<void> {
    return feedGeneratorService.describeFeedGenerator(req, res);
  }

  async getPopularFeedGenerators(req: Request, res: Response): Promise<void> {
    return feedGeneratorService.getPopularFeedGenerators(req, res);
  }

  async getSuggestedFeedsUnspecced(req: Request, res: Response): Promise<void> {
    return feedGeneratorService.getSuggestedFeedsUnspecced(req, res);
  }

  // List Service (6 endpoints)
  async getList(req: Request, res: Response): Promise<void> {
    return listService.getList(req, res);
  }

  async getLists(req: Request, res: Response): Promise<void> {
    return listService.getLists(req, res);
  }

  async getListFeed(req: Request, res: Response): Promise<void> {
    return listService.getListFeed(req, res);
  }

  async getListsWithMembership(req: Request, res: Response): Promise<void> {
    return listService.getListsWithMembership(req, res);
  }

  async getListMutes(req: Request, res: Response): Promise<void> {
    return listService.getListMutes(req, res);
  }

  async getListBlocks(req: Request, res: Response): Promise<void> {
    return listService.getListBlocks(req, res);
  }

  // Graph Service (4 endpoints)
  async getRelationships(req: Request, res: Response): Promise<void> {
    return graphService.getRelationships(req, res);
  }

  async getKnownFollowers(req: Request, res: Response): Promise<void> {
    return graphService.getKnownFollowers(req, res);
  }

  async getFollows(req: Request, res: Response): Promise<void> {
    return graphService.getFollows(req, res);
  }

  async getFollowers(req: Request, res: Response): Promise<void> {
    return graphService.getFollowers(req, res);
  }

  // Timeline Service (6 endpoints)
  async getTimeline(req: Request, res: Response): Promise<void> {
    return timelineService.getTimeline(req, res);
  }

  async getAuthorFeed(req: Request, res: Response): Promise<void> {
    return timelineService.getAuthorFeed(req, res);
  }

  async getPostThread(req: Request, res: Response): Promise<void> {
    return timelineService.getPostThread(req, res);
  }

  async getFeed(req: Request, res: Response): Promise<void> {
    return timelineService.getFeed(req, res);
  }

  async getPostThreadV2(req: Request, res: Response): Promise<void> {
    return timelineService.getPostThreadV2(req, res);
  }

  async getPostThreadOtherV2(req: Request, res: Response): Promise<void> {
    return timelineService.getPostThreadOtherV2(req, res);
  }

  // Actor/Profile Service (5 endpoints)
  async getProfile(req: Request, res: Response): Promise<void> {
    return actorService.getProfile(req, res);
  }

  async getProfiles(req: Request, res: Response): Promise<void> {
    return actorService.getProfiles(req, res);
  }

  async getSuggestions(req: Request, res: Response): Promise<void> {
    return actorService.getSuggestions(req, res);
  }

  async getSuggestedFollowsByActor(req: Request, res: Response): Promise<void> {
    return actorService.getSuggestedFollowsByActor(req, res);
  }

  async getSuggestedUsersUnspecced(req: Request, res: Response): Promise<void> {
    return actorService.getSuggestedUsersUnspecced(req, res);
  }

  // Moderation Service (10 endpoints)
  async getBlocks(req: Request, res: Response): Promise<void> {
    return moderationService.getBlocks(req, res);
  }

  async getMutes(req: Request, res: Response): Promise<void> {
    return moderationService.getMutes(req, res);
  }

  async muteActor(req: Request, res: Response): Promise<void> {
    return moderationService.muteActor(req, res);
  }

  async unmuteActor(req: Request, res: Response): Promise<void> {
    return moderationService.unmuteActor(req, res);
  }

  async muteActorList(req: Request, res: Response): Promise<void> {
    return moderationService.muteActorList(req, res);
  }

  async unmuteActorList(req: Request, res: Response): Promise<void> {
    return moderationService.unmuteActorList(req, res);
  }

  async muteThread(req: Request, res: Response): Promise<void> {
    return moderationService.muteThread(req, res);
  }

  async unmuteThread(req: Request, res: Response): Promise<void> {
    return moderationService.unmuteThread(req, res);
  }

  async queryLabels(req: Request, res: Response): Promise<void> {
    return moderationService.queryLabels(req, res);
  }

  async createReport(req: Request, res: Response): Promise<void> {
    return moderationService.createReport(req, res);
  }

  // Unspecced Service (6 endpoints)
  async getTaggedSuggestions(req: Request, res: Response): Promise<void> {
    return unspeccedService.getTaggedSuggestions(req, res);
  }

  async getTrendingTopics(req: Request, res: Response): Promise<void> {
    return unspeccedService.getTrendingTopics(req, res);
  }

  async getTrends(req: Request, res: Response): Promise<void> {
    return unspeccedService.getTrends(req, res);
  }

  async getUnspeccedConfig(req: Request, res: Response): Promise<void> {
    return unspeccedService.getUnspeccedConfig(req, res);
  }

  async getAgeAssuranceState(req: Request, res: Response): Promise<void> {
    return unspeccedService.getAgeAssuranceState(req, res);
  }

  async initAgeAssurance(req: Request, res: Response): Promise<void> {
    return unspeccedService.initAgeAssurance(req, res);
  }

  // Post Interaction Service (5 endpoints)
  async getPosts(req: Request, res: Response): Promise<void> {
    return postInteractionService.getPosts(req, res);
  }

  async getLikes(req: Request, res: Response): Promise<void> {
    return postInteractionService.getLikes(req, res);
  }

  async getRepostedBy(req: Request, res: Response): Promise<void> {
    return postInteractionService.getRepostedBy(req, res);
  }

  async getQuotes(req: Request, res: Response): Promise<void> {
    return postInteractionService.getQuotes(req, res);
  }

  async getActorLikes(req: Request, res: Response): Promise<void> {
    return postInteractionService.getActorLikes(req, res);
  }

  // ============================================================================
  // ALL ENDPOINTS NOW EXTRACTED!
  // Legacy instance kept for backward compatibility and cache access
  // ============================================================================

  // Public utility method (still delegated to legacy for cache access)
  invalidatePreferencesCache(userDid: string): void {
    return this.legacy.invalidatePreferencesCache(userDid);
  }
}

// Export singleton instance
export const xrpcOrchestrator = new XRPCOrchestrator();

// Default export for convenience
export default xrpcOrchestrator;
