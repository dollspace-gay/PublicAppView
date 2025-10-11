// Actor hydrator matching Bluesky's implementation
import { db } from '../../db';
import { 
  users, verifications, activitySubscriptions, statuses, 
  chatDeclarations, notificationDeclarations, knownFollowers,
  bidirectionalBlocks
} from '../../../shared/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { 
  Actor, 
  ProfileViewerState,
  ProfileAgg,
  KnownFollowersState,
  ActivitySubscriptionState,
  HydrationMap
} from '../../types';
import { INVALID_HANDLE } from '@atproto/syntax';

export class ActorHydrator {
  constructor() {}

  // Get actors with full hydration
  async getActors(
    dids: string[],
    options: {
      includeTakedowns?: boolean;
      skipCacheForDids?: string[];
    } = {}
  ): Promise<HydrationMap<Actor>> {
    if (dids.length === 0) return new HydrationMap();

    const usersData = await db
      .select()
      .from(users)
      .where(inArray(users.did, dids));

    const actors = new HydrationMap<Actor>();
    
    for (const user of usersData) {
      const actor: Actor = {
        did: user.did,
        handle: user.handle ?? INVALID_HANDLE,
        profile: user.profileRecord as any,
        profileCid: user.profileCid || undefined,
        profileTakedownRef: user.profileTakedownRef || undefined,
        sortedAt: user.sortedAt || undefined,
        indexedAt: user.indexedAt || undefined,
        takedownRef: user.takedownRef || undefined,
        isLabeler: user.isLabeler || false,
        allowIncomingChatsFrom: user.allowIncomingChatsFrom || 'none',
        upstreamStatus: user.upstreamStatus || undefined,
        createdAt: user.createdAt || undefined,
        priorityNotifications: user.priorityNotifications || false,
        trustedVerifier: user.trustedVerifier || false,
        verifications: [], // TODO: Implement verifications
        allowActivitySubscriptionsFrom: user.allowActivitySubscriptionsFrom || 'none',
      };
      
      actors.set(user.did, actor);
    }

    return actors;
  }

  // Get profile viewer states for actors
  async getProfileViewerStatesNaive(
    dids: string[],
    viewerDid: string
  ): Promise<Map<string, ProfileViewerState>> {
    const result = new Map<string, ProfileViewerState>();

    // Get blocking relationships
    const blocking = await db
      .select()
      .from(sql`blocks`)
      .where(
        and(
          eq(sql`blocker_did`, viewerDid),
          inArray(sql`blocked_did`, dids)
        )
      );

    const blockedBy = await db
      .select()
      .from(sql`blocks`)
      .where(
        and(
          eq(sql`blocked_did`, viewerDid),
          inArray(sql`blocker_did`, dids)
        )
      );

    // Get muting relationships
    const muting = await db
      .select()
      .from(sql`mutes`)
      .where(
        and(
          eq(sql`muter_did`, viewerDid),
          inArray(sql`muted_did`, dids)
        )
      );

    // Build relationship map
    for (const did of dids) {
      const state: ProfileViewerState = {};
      
      if (blocking.some(b => b.blocked_did === did)) {
        state.blocking = true;
      }
      
      if (blockedBy.some(b => b.blocker_did === did)) {
        state.blockedBy = true;
      }
      
      if (muting.some(m => m.muted_did === did)) {
        state.muted = true;
      }

      result.set(did, state);
    }

    return result;
  }

  // Get profile aggregates
  async getProfileAggregates(dids: string[]): Promise<Map<string, ProfileAgg>> {
    if (dids.length === 0) return new Map();

    // TODO: Implement profile aggregates
    // This would typically query follower counts, following counts, post counts, etc.
    const result = new Map<string, ProfileAgg>();
    
    for (const did of dids) {
      result.set(did, {
        followers: 0,
        follows: 0,
        posts: 0,
        lists: 0,
        feeds: 0,
        starterPacks: 0,
      });
    }

    return result;
  }

  // Get known followers
  async getKnownFollowers(
    dids: string[],
    viewerDid: string | null
  ): Promise<Map<string, KnownFollowersState>> {
    if (!viewerDid || dids.length === 0) return new Map();

    const result = new Map<string, KnownFollowersState>();
    
    // TODO: Implement known followers logic
    // This would find followers of the subjects who are also followed by the viewer
    
    return result;
  }

  // Get activity subscriptions
  async getActivitySubscriptions(
    dids: string[],
    viewerDid: string | null
  ): Promise<Map<string, ActivitySubscriptionState>> {
    if (!viewerDid || dids.length === 0) return new Map();

    const result = new Map<string, ActivitySubscriptionState>();
    
    // TODO: Implement activity subscriptions
    // This would check if the viewer is subscribed to activity notifications from these users
    
    return result;
  }

  // Get verifications for actors
  async getVerifications(dids: string[]): Promise<Map<string, any[]>> {
    if (dids.length === 0) return new Map();

    const verificationsData = await db
      .select()
      .from(verifications)
      .where(inArray(verifications.subjectDid, dids));

    const result = new Map<string, any[]>();
    
    for (const verification of verificationsData) {
      const existing = result.get(verification.subjectDid) || [];
      existing.push({
        issuer: verification.issuerDid,
        uri: verification.uri,
        handle: verification.handle,
        displayName: verification.displayName,
        createdAt: verification.createdAt.toISOString(),
      });
      result.set(verification.subjectDid, existing);
    }

    return result;
  }

  // Get statuses for actors
  async getStatuses(dids: string[]): Promise<Map<string, any>> {
    if (dids.length === 0) return new Map();

    const statusesData = await db
      .select()
      .from(statuses)
      .where(inArray(statuses.authorDid, dids));

    const result = new Map<string, any>();
    
    for (const status of statusesData) {
      result.set(status.authorDid, {
        uri: status.uri,
        cid: status.cid,
        record: status.record,
        status: status.status,
        embed: status.embed,
        expiresAt: status.expiresAt?.toISOString(),
        createdAt: status.createdAt.toISOString(),
        indexedAt: status.indexedAt.toISOString(),
      });
    }

    return result;
  }
}