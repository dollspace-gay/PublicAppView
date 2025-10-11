// Actor types matching Bluesky's implementation
import { Record as ProfileRecord } from '../lexicon/types/app/bsky/actor/profile';
import { Record as StatusRecord } from '../lexicon/types/app/bsky/actor/status';
import { Record as NotificationDeclarationRecord } from '../lexicon/types/app/bsky/notification/declaration';
import { Record as ChatDeclarationRecord } from '../lexicon/types/chat/bsky/actor/declaration';
import { RecordInfo } from './hydration';

type AllowActivitySubscriptions = Extract<
  NotificationDeclarationRecord['allowSubscriptions'],
  'followers' | 'mutuals' | 'none'
>

export interface Actor {
  did: string;
  handle?: string;  // Optional in data, but always present in views
  profile?: ProfileRecord;
  profileCid?: string;
  profileTakedownRef?: string;
  sortedAt?: Date;
  indexedAt?: Date;
  takedownRef?: string;
  isLabeler: boolean;
  allowIncomingChatsFrom?: string;
  upstreamStatus?: string;
  createdAt?: Date;
  priorityNotifications: boolean;
  trustedVerifier?: boolean;
  verifications: VerificationHydrationState[];
  status?: RecordInfo<StatusRecord>;
  allowActivitySubscriptionsFrom: AllowActivitySubscriptions;
}

export interface VerificationHydrationState {
  issuer: string;
  uri: string;
  handle: string;
  displayName: string;
  createdAt: string;
}

export type Actors = Map<string, Actor>;

export interface ChatDeclaration extends RecordInfo<ChatDeclarationRecord> {}
export type ChatDeclarations = Map<string, ChatDeclaration>;

export interface NotificationDeclaration extends RecordInfo<NotificationDeclarationRecord> {}
export type NotificationDeclarations = Map<string, NotificationDeclaration>;

export interface Status extends RecordInfo<StatusRecord> {}
export type Statuses = Map<string, Status>;

export interface ProfileViewerState {
  muted?: boolean;
  mutedByList?: string;  // URI, not object
  blockedBy?: string;    // URI, not boolean
  blocking?: string;     // URI, not boolean
  blockedByList?: string;
  blockingByList?: string;
  following?: string;    // URI, not boolean
  followedBy?: string;   // URI, not boolean
  knownFollowers?: KnownFollowersState;
  activitySubscription?: ActivitySubscriptionState;
}

export type ProfileViewerStates = Map<string, ProfileViewerState>;

export interface ActivitySubscriptionState {
  post: boolean;
  reply: boolean;
}

export type ActivitySubscriptionStates = Map<string, ActivitySubscriptionState | undefined>;

export interface KnownFollowersState {
  count: number;
  followers: string[];
}

export type KnownFollowersStates = Map<string, KnownFollowersState | undefined>;

export interface ProfileAgg {
  followers: number;
  follows: number;
  posts: number;
  lists: number;
  feeds: number;
  starterPacks: number;
}

export type ProfileAggs = Map<string, ProfileAgg>;

export interface ProfileAssociated {
  lists?: number;
  feedgens?: number;
  starterPacks?: number;
  labeler?: boolean;
  chat?: ProfileAssociatedChat;
  activitySubscription?: ProfileAssociatedActivitySubscription;
}

export interface ProfileAssociatedChat {
  allowIncoming: 'all' | 'none' | 'following' | string;
}

export interface ProfileAssociatedActivitySubscription {
  allowSubscriptions: 'followers' | 'mutuals' | 'none' | string;
}