// Hydration types matching Bluesky's implementation
import { CID } from 'multiformats/cid';

export class HydrationMap<T> extends Map<string, T | null> implements Merges {
  merge(map: HydrationMap<T>): this {
    map.forEach((val, key) => {
      this.set(key, val);
    });
    return this;
  }
}

export interface Merges {
  merge<T extends this>(map: T): this;
}

type UnknownRecord = { $type: string; [x: string]: unknown };

export interface RecordInfo<T extends UnknownRecord> {
  record: T;
  cid: string;
  sortedAt: Date;
  indexedAt: Date;
  takedownRef: string | undefined;
}

export interface ItemRef {
  uri: string;
  cid?: string;
}

export const mergeMaps = <V, M extends HydrationMap<V>>(
  mapA?: M,
  mapB?: M,
): M | undefined => {
  if (!mapA) return mapB;
  if (!mapB) return mapA;
  return mapA.merge(mapB);
};

export const mergeNestedMaps = <V, M extends HydrationMap<HydrationMap<V>>>(
  mapA?: M,
  mapB?: M,
): M | undefined => {
  if (!mapA) return mapB;
  if (!mapB) return mapA;

  for (const [key, map] of mapB) {
    const merged = mergeMaps(mapA.get(key) ?? undefined, map ?? undefined);
    mapA.set(key, merged ?? null);
  }
  return mapA;
};

export const parseRecord = <T extends UnknownRecord>(
  bytes: Uint8Array,
  lexiconId: string,
): T => {
  // Implementation would parse the record from bytes
  // For now, return a basic structure
  return {} as T;
};

export const parseString = (str: string | undefined): string | undefined => {
  return str;
};

export const safeTakedownRef = (ref: string | undefined): string | undefined => {
  return ref;
};

export const isActivitySubscriptionEnabled = (sub: any): boolean => {
  return sub?.post === true || sub?.reply === true;
};

// Hydration state interface
export interface HydrationState {
  actors?: HydrationMap<import('./actor').Actor>;
  posts?: HydrationMap<import('./feed').Post>;
  reposts?: HydrationMap<import('./feed').Repost>;
  likes?: HydrationMap<import('./feed').Like>;
  follows?: HydrationMap<any>; // Follow type would be defined elsewhere
  blocks?: HydrationMap<any>; // Block type would be defined elsewhere
  mutes?: HydrationMap<any>; // Mute type would be defined elsewhere
  profileViewers?: HydrationMap<import('./actor').ProfileViewerState>;
  postViewers?: HydrationMap<import('./feed').PostViewerState>;
  postAggs?: HydrationMap<import('./feed').PostAgg>;
  profileAggs?: HydrationMap<import('./actor').ProfileAgg>;
  labels?: HydrationMap<import('./feed').Label[]>;
  threadContexts?: HydrationMap<import('./feed').ThreadContext>;
  feedgens?: HydrationMap<any>; // FeedGen type
  feedgenViewers?: HydrationMap<any>; // FeedGenViewerState type
  feedgenAggs?: HydrationMap<any>; // FeedGenAgg type
  threadgates?: HydrationMap<any>; // Threadgate type
  postgates?: HydrationMap<any>; // Postgate type
  lists?: HydrationMap<any>; // List type
  listItems?: HydrationMap<any>; // ListItem type
  listViewers?: HydrationMap<any>; // ListViewerState type
  listAggs?: HydrationMap<any>; // ListAgg type
  starterPacks?: HydrationMap<any>; // StarterPack type
  starterPackAggs?: HydrationMap<any>; // StarterPackAgg type
  knownFollowers?: HydrationMap<import('./actor').KnownFollowersState>;
  activitySubscriptions?: HydrationMap<import('./actor').ActivitySubscriptionState>;
  verifications?: HydrationMap<any>; // Verification type
  statuses?: HydrationMap<any>; // Status type
  chatDeclarations?: HydrationMap<any>; // ChatDeclaration type
  notificationDeclarations?: HydrationMap<any>; // NotificationDeclaration type
  bidirectionalBlocks?: HydrationMap<Map<string, boolean>>;
  postBlocks?: HydrationMap<{
    parent?: boolean;
    root?: boolean;
    embed?: boolean;
  }>;
  ctx?: {
    viewer?: string;
    include3pBlocks?: boolean;
  };
}