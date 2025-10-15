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

  // ============================================================================
  // LEGACY ENDPOINTS (Not yet extracted)
  // These delegate to the original XRPCApi class
  // ============================================================================

  // Timeline & Feed endpoints
  async getTimeline(req: Request, res: Response): Promise<void> {
    return this.legacy.getTimeline(req, res);
  }

  async getAuthorFeed(req: Request, res: Response): Promise<void> {
    return this.legacy.getAuthorFeed(req, res);
  }

  async getPostThread(req: Request, res: Response): Promise<void> {
    return this.legacy.getPostThread(req, res);
  }

  async getFeed(req: Request, res: Response): Promise<void> {
    return this.legacy.getFeed(req, res);
  }

  async getPostThreadV2(req: Request, res: Response): Promise<void> {
    return this.legacy.getPostThreadV2(req, res);
  }

  async getPostThreadOtherV2(req: Request, res: Response): Promise<void> {
    return this.legacy.getPostThreadOtherV2(req, res);
  }

  // Actor/Profile endpoints
  async getProfile(req: Request, res: Response): Promise<void> {
    return this.legacy.getProfile(req, res);
  }

  async getProfiles(req: Request, res: Response): Promise<void> {
    return this.legacy.getProfiles(req, res);
  }

  async getFollows(req: Request, res: Response): Promise<void> {
    return this.legacy.getFollows(req, res);
  }

  async getFollowers(req: Request, res: Response): Promise<void> {
    return this.legacy.getFollowers(req, res);
  }

  async getSuggestions(req: Request, res: Response): Promise<void> {
    return this.legacy.getSuggestions(req, res);
  }

  async getSuggestedFollowsByActor(req: Request, res: Response): Promise<void> {
    return this.legacy.getSuggestedFollowsByActor(req, res);
  }

  async getSuggestedUsersUnspecced(req: Request, res: Response): Promise<void> {
    return this.legacy.getSuggestedUsersUnspecced(req, res);
  }

  // Social Graph endpoints
  async getRelationships(req: Request, res: Response): Promise<void> {
    return this.legacy.getRelationships(req, res);
  }

  async getKnownFollowers(req: Request, res: Response): Promise<void> {
    return this.legacy.getKnownFollowers(req, res);
  }

  async getListsWithMembership(req: Request, res: Response): Promise<void> {
    return this.legacy.getListsWithMembership(req, res);
  }

  // Moderation endpoints
  async getBlocks(req: Request, res: Response): Promise<void> {
    return this.legacy.getBlocks(req, res);
  }

  async getMutes(req: Request, res: Response): Promise<void> {
    return this.legacy.getMutes(req, res);
  }

  async muteActor(req: Request, res: Response): Promise<void> {
    return this.legacy.muteActor(req, res);
  }

  async unmuteActor(req: Request, res: Response): Promise<void> {
    return this.legacy.unmuteActor(req, res);
  }

  async getListMutes(req: Request, res: Response): Promise<void> {
    return this.legacy.getListMutes(req, res);
  }

  async getListBlocks(req: Request, res: Response): Promise<void> {
    return this.legacy.getListBlocks(req, res);
  }

  async muteActorList(req: Request, res: Response): Promise<void> {
    return this.legacy.muteActorList(req, res);
  }

  async unmuteActorList(req: Request, res: Response): Promise<void> {
    return this.legacy.unmuteActorList(req, res);
  }

  async muteThread(req: Request, res: Response): Promise<void> {
    return this.legacy.muteThread(req, res);
  }

  async unmuteThread(req: Request, res: Response): Promise<void> {
    return this.legacy.unmuteThread(req, res);
  }

  async queryLabels(req: Request, res: Response): Promise<void> {
    return this.legacy.queryLabels(req, res);
  }

  async createReport(req: Request, res: Response): Promise<void> {
    return this.legacy.createReport(req, res);
  }

  // Unspecced/misc endpoints
  async getTaggedSuggestions(req: Request, res: Response): Promise<void> {
    return this.legacy.getTaggedSuggestions(req, res);
  }

  async getTrendingTopics(req: Request, res: Response): Promise<void> {
    return this.legacy.getTrendingTopics(req, res);
  }

  async getTrends(req: Request, res: Response): Promise<void> {
    return this.legacy.getTrends(req, res);
  }

  async getUnspeccedConfig(req: Request, res: Response): Promise<void> {
    return this.legacy.getUnspeccedConfig(req, res);
  }

  async getAgeAssuranceState(req: Request, res: Response): Promise<void> {
    return this.legacy.getAgeAssuranceState(req, res);
  }

  async initAgeAssurance(req: Request, res: Response): Promise<void> {
    return this.legacy.initAgeAssurance(req, res);
  }

  // Public utility method (still delegated to legacy for cache access)
  invalidatePreferencesCache(userDid: string): void {
    return this.legacy.invalidatePreferencesCache(userDid);
  }
}

// Export singleton instance
export const xrpcOrchestrator = new XRPCOrchestrator();

// Default export for convenience
export default xrpcOrchestrator;
