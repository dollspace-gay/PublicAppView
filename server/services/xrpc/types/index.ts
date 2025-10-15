/**
 * XRPC Types Index
 * Centralized export of all type definitions
 */

// ATProto Record Types
export * from './atproto-records';

// API View Types
export * from './api-views';

// Database Model Types
export * from './database-models';

// Common Types
export * from './common';

// Re-export commonly used types for convenience
export type {
  // Records
  PostRecord,
  ProfileRecord,
  FollowRecord,
  LikeRecord,
  RepostRecord,
  BlockRecord,
  ListRecord,
  FeedGeneratorRecord,
  StarterPackRecord,

  // Views
  ProfileViewBasic,
  ProfileView,
  ProfileViewDetailed,
  PostView,
  FeedViewPost,
  ThreadViewPost,
  ListView,
  GeneratorView,
  StarterPackView,
  Label,
  Notification,

  // Database Models
  UserModel,
  PostModel,
  PostAggregation,
  PostViewerState,
  FollowModel,
  LikeModel,
  RepostModel,
  BlockModel,
  BookmarkModel,
  ListModel,
  FeedGeneratorModel,
  StarterPackModel,
  HydrationState,

  // Common
  XRPCHandler,
  PaginationParams,
  PaginatedResponse,
  ErrorResponse,
  SuccessResponse,
  ATUri,
  DIDDocument,
  JWTPayload,
  SearchParams,
  ActorFilter,
  NotificationReason,
  PushPlatform,
  ImageFormat,
} from './index';
