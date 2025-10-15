/**
 * Common Types
 * Shared type definitions used across the XRPC API
 */

import type { Request, Response } from 'express';

/**
 * XRPC endpoint handler
 */
export type XRPCHandler = (req: Request, res: Response) => Promise<void>;

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit: number;
  cursor?: string;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  items?: T[];
  cursor?: string;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  message: string;
}

/**
 * Success response
 */
export interface SuccessResponse {
  success: boolean;
}

/**
 * AT URI components
 */
export interface ATUri {
  repo: string; // DID
  collection: string;
  rkey: string;
}

/**
 * DID document
 */
export interface DIDDocument {
  '@context'?: string[];
  id: string;
  alsoKnownAs?: string[];
  verificationMethod?: VerificationMethod[];
  service?: Service[];
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
}

export interface Service {
  id: string;
  type: string;
  serviceEndpoint: string;
}

/**
 * JWT payload
 */
export interface JWTPayload {
  sub: string; // Subject (usually DID)
  iss: string; // Issuer
  aud?: string; // Audience
  exp?: number; // Expiration time
  iat?: number; // Issued at
  nbf?: number; // Not before
  jti?: string; // JWT ID
  scope?: string;
  did?: string;
  lxm?: string; // Lexicon method
}

/**
 * Cache entry with TTL
 */
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * Content filter settings
 */
export interface ContentFilterSettings {
  hideReplies?: boolean;
  hideRepliesByUnfollowed?: boolean;
  hideRepliesByLikeCount?: number;
  hideReposts?: boolean;
  hideQuotePosts?: boolean;
  adultContentEnabled?: boolean;
  labelPreferences?: Record<string, 'ignore' | 'show' | 'warn' | 'hide'>;
}

/**
 * Feed algorithm types
 */
export type FeedAlgorithm =
  | 'reverse-chronological'
  | 'at-protocol-popular'
  | 'custom';

/**
 * Video upload limits
 */
export interface VideoUploadLimits {
  canUpload: boolean;
  remainingDailyVideos: number;
  remainingDailyBytes: number;
  message?: string;
  error?: string;
}

/**
 * Interaction event
 */
export interface InteractionEvent {
  $type?: string;
  subject?: unknown;
  event?: string;
  createdAt?: string;
}

/**
 * Moderation report
 */
export interface ModerationReport {
  id: string;
  reasonType: 'spam' | 'violation' | 'misleading' | 'sexual' | 'rude' | 'other';
  reason?: string;
  subject: {
    $type: string;
    uri?: string;
    did?: string;
    cid?: string;
  };
  reportedBy: string;
  createdAt: Date;
}

/**
 * Search query parameters
 */
export interface SearchParams {
  q: string;
  limit: number;
  cursor?: string;
}

/**
 * Actor filter types
 */
export type ActorFilter =
  | 'posts_with_replies'
  | 'posts_no_replies'
  | 'posts_with_media'
  | 'posts_and_author_threads'
  | 'posts_with_video';

/**
 * Thread sorting
 */
export type ThreadSort = 'oldest' | 'newest' | 'most-likes' | 'random';

/**
 * Notification reason types
 */
export type NotificationReason =
  | 'like'
  | 'repost'
  | 'follow'
  | 'mention'
  | 'reply'
  | 'quote'
  | 'starterpack-joined';

/**
 * Platform types for push notifications
 */
export type PushPlatform = 'ios' | 'android' | 'web';

/**
 * Image format types for CDN
 */
export type ImageFormat =
  | 'avatar'
  | 'banner'
  | 'feed_thumbnail'
  | 'feed_fullsize';

/**
 * Type guard utilities
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/**
 * Optional type helper
 */
export type Optional<T> = T | undefined;

/**
 * Nullable type helper
 */
export type Nullable<T> = T | null;

/**
 * Deep partial type
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Extract keys of type T that have value type V
 */
export type KeysOfType<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];

/**
 * Make specific keys required
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific keys optional
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;
