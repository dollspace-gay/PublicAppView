## XRPC Type Definitions

This directory contains comprehensive TypeScript type definitions for the XRPC API, organized by functional domain.

## Purpose

These types replace the use of `any` throughout the codebase, providing:
- ✅ **Type safety** - Catch errors at compile time
- ✅ **IntelliSense** - Better IDE autocomplete
- ✅ **Documentation** - Self-documenting code
- ✅ **Refactoring** - Safer code changes
- ✅ **Linter compliance** - Fix `@typescript-eslint/no-explicit-any` warnings

## Organization

### `atproto-records.ts` (311 lines)

**AT Protocol record type definitions**

Contains types for all ATProto record types (the actual data stored in repos):
- `PostRecord` - Post records
- `ProfileRecord` - Actor profile records
- `FollowRecord` - Follow relationship records
- `LikeRecord` - Like records
- `RepostRecord` - Repost records
- `BlockRecord` - Block records
- `ListRecord` - List records
- `FeedGeneratorRecord` - Custom feed records
- `StarterPackRecord` - Starter pack records
- `LabelerRecord` - Labeler service records
- `ThreadgateRecord` - Thread gate records

Also includes embedded types:
- `PostEmbed` - Images, external links, videos, record quotes
- `Facet` - Rich text formatting (mentions, links, tags)
- `BlobRef` - Blob/file references
- `StrongRef` - URI + CID references

**Usage:**
```typescript
import { PostRecord, ProfileRecord } from './types';

const post: PostRecord = {
  $type: 'app.bsky.feed.post',
  text: 'Hello world!',
  createdAt: new Date().toISOString(),
};
```

### `api-views.ts` (503 lines)

**API response view type definitions**

Contains types for API response objects (views):
- `ProfileViewBasic` - Basic profile view
- `ProfileView` - Standard profile view
- `ProfileViewDetailed` - Detailed profile with all fields
- `PostView` - Post view with author, embeds, counts
- `FeedViewPost` - Post in feed context with reply/repost info
- `ThreadViewPost` - Post in thread context with parent/children
- `ListView` - List view
- `GeneratorView` - Feed generator view
- `StarterPackView` - Starter pack view
- `EmbedView` - Embed views (images, external, video, etc.)
- `Label` - Content label
- `Notification` - Notification view
- `Preference` - User preferences

**Usage:**
```typescript
import { PostView, ProfileViewBasic } from './types';

const postView: PostView = {
  uri: 'at://did:plc:abc/app.bsky.feed.post/123',
  cid: 'bafyrei...',
  author: authorProfile,
  record: postRecord,
  replyCount: 5,
  likeCount: 10,
  indexedAt: new Date().toISOString(),
};
```

### `database-models.ts` (453 lines)

**Database model type definitions**

Contains types for database query results and storage models:
- `UserModel` - User/actor from database
- `PostModel` - Post from database
- `PostAggregation` - Post engagement stats
- `PostViewerState` - Viewer's interaction with post
- `FollowModel`, `LikeModel`, `RepostModel`, etc.
- `BookmarkModel` - Bookmark records
- `ListModel` - List records
- `FeedGeneratorModel` - Feed generator records
- `StarterPackModel` - Starter pack records
- `NotificationModel` - Notification records
- `HydrationState` - Optimized hydration state
- `SessionModel` - User session
- `VideoJobModel` - Video processing job

**Usage:**
```typescript
import { UserModel, PostModel } from './types';

const user: UserModel = await storage.getUser(did);
const posts: PostModel[] = await storage.getPosts(uris);
```

### `common.ts` (279 lines)

**Common shared type definitions**

Contains utility types and helpers:
- `XRPCHandler` - Endpoint handler function signature
- `PaginationParams` - Pagination parameters
- `PaginatedResponse<T>` - Generic paginated response
- `ErrorResponse` - Error response format
- `SuccessResponse` - Success response format
- `ATUri` - AT URI components
- `DIDDocument` - DID document structure
- `JWTPayload` - JWT token payload
- `SearchParams` - Search query parameters
- `ActorFilter` - Actor feed filter types
- `NotificationReason` - Notification reason types
- `ImageFormat` - CDN image format types

Type guards:
- `isRecord()` - Check if value is a record
- `isString()` - Check if value is a string
- `isDefined()` - Check if value is defined

Utility types:
- `Result<T, E>` - Result type for error handling
- `Optional<T>` - Optional type helper
- `DeepPartial<T>` - Deep partial type
- `RequireKeys<T, K>` - Make specific keys required

**Usage:**
```typescript
import { XRPCHandler, PaginatedResponse, isRecord } from './types';

const handler: XRPCHandler = async (req, res) => {
  // Implementation
};

const response: PaginatedResponse<PostView> = {
  items: posts,
  cursor: nextCursor,
};

if (isRecord(value)) {
  // TypeScript knows value is Record<string, unknown>
}
```

## Usage Patterns

### Replacing `any` in Function Signatures

**Before:**
```typescript
async function serializePosts(posts: any[], viewerDid?: string) {
  // ...
}
```

**After:**
```typescript
import { PostModel, PostView } from './types';

async function serializePosts(
  posts: PostModel[],
  viewerDid?: string
): Promise<PostView[]> {
  // ...
}
```

### Replacing `any` in Database Queries

**Before:**
```typescript
const users: any[] = await storage.getUsers(dids);
```

**After:**
```typescript
import { UserModel } from './types';

const users: UserModel[] = await storage.getUsers(dids);
```

### Using Type Guards

**Before:**
```typescript
function processEmbed(embed: any) {
  if (embed.$type === 'app.bsky.embed.images') {
    // No type safety
  }
}
```

**After:**
```typescript
import { PostEmbed, ImagesEmbed } from './types';

function processEmbed(embed: PostEmbed) {
  if (embed.$type === 'app.bsky.embed.images') {
    // TypeScript knows embed is ImagesEmbed
    const images = embed.images; // ✅ Type safe
  }
}
```

### Working with Records

**Before:**
```typescript
const record: any = {
  $type: 'app.bsky.feed.post',
  text: 'Hello',
  // No autocomplete, no type checking
};
```

**After:**
```typescript
import { PostRecord } from './types';

const record: PostRecord = {
  $type: 'app.bsky.feed.post',
  text: 'Hello',
  createdAt: new Date().toISOString(),
  // ✅ Autocomplete works
  // ✅ Required fields enforced
  // ✅ Type checking on all fields
};
```

## Benefits

### Type Safety
```typescript
// Before: Runtime error
const post: any = await getPost(uri);
console.log(post.authr.handle); // Typo! Runtime error

// After: Compile error
const post: PostView = await getPost(uri);
console.log(post.authr.handle); // ❌ Compile error: Property 'authr' does not exist
console.log(post.author.handle); // ✅ Correct
```

### Better IntelliSense
```typescript
import { PostView } from './types';

const post: PostView = ...;
post. // ← IDE shows all available fields
     // uri, cid, author, record, embed, replyCount, etc.
```

### Self-Documenting
```typescript
// Function signature tells you exactly what it accepts and returns
async function createPost(
  record: PostRecord,
  userDid: string
): Promise<PostView> {
  // No need to guess what fields record has
  // No need to check documentation for return type
}
```

### Safer Refactoring
```typescript
// If you change a type, TypeScript will find all places that need updating
interface PostView {
  uri: string;
  // likeCount: number; ← Remove this field
  engagementCount: number; // ← Add this field
}

// TypeScript will error everywhere likeCount is accessed
// You can fix all issues before runtime
```

## Migration Strategy

### Phase 1: Define Types ✅ COMPLETE
- Created comprehensive type library (1,619 lines)
- Organized into 4 domain-specific files
- 0 linter warnings

### Phase 2: Update New Code 🚧 ONGOING
- Use types in all new service modules
- Example: bookmark-service.ts already uses types
- Each new service should import and use types

### Phase 3: Update Existing Code ⏳ FUTURE
- Gradually replace `any` in existing files
- Start with simple files
- Move to complex files
- Update one service at a time

### Phase 4: Enforce Strict Types ⏳ FUTURE
- Enable `noImplicitAny` in tsconfig
- Remove all `any` types
- Achieve 100% type safety

## Statistics

### Files Created: 5
- `atproto-records.ts` (311 lines)
- `api-views.ts` (503 lines)
- `database-models.ts` (453 lines)
- `common.ts` (279 lines)
- `index.ts` (73 lines)

### Total Lines: 1,619 lines
- Comprehensive type coverage
- Zero linter warnings
- Full ATProto spec compliance

### Types Defined: 100+
- Record types: 15+
- View types: 30+
- Database models: 25+
- Common types: 30+

## Example: Before & After

### Before (Using `any`)
```typescript
async function getTimeline(userDid: string): Promise<any> {
  const posts: any[] = await storage.getTimeline(userDid);
  const authors: any[] = await storage.getUsers(
    posts.map((p: any) => p.authorDid)
  );
  
  return posts.map((post: any) => {
    const author: any = authors.find((a: any) => a.did === post.authorDid);
    return {
      uri: post.uri,
      author: {
        handle: author.handle, // Could be undefined!
      },
    };
  });
}
```

### After (Using Types)
```typescript
import { UserModel, PostModel, PostView, ProfileViewBasic } from './types';

async function getTimeline(userDid: string): Promise<PostView[]> {
  const posts: PostModel[] = await storage.getTimeline(userDid);
  const authorDids = posts.map((p) => p.authorDid);
  const authors: UserModel[] = await storage.getUsers(authorDids);
  const authorMap = new Map(authors.map((a) => [a.did, a]));
  
  return posts.map((post): PostView => {
    const author = authorMap.get(post.authorDid);
    if (!author) {
      throw new Error(`Author not found: ${post.authorDid}`);
    }
    
    const authorView: ProfileViewBasic = {
      did: author.did,
      handle: author.handle, // ✅ Guaranteed to exist
      displayName: author.displayName,
    };
    
    return {
      uri: post.uri,
      cid: post.cid,
      author: authorView,
      record: { /* ... */ },
      replyCount: post.replyCount || 0,
      likeCount: post.likeCount || 0,
      indexedAt: post.indexedAt.toISOString(),
    };
  });
}
```

## Resources

- [ATProto Lexicon Docs](https://atproto.com/specs/lexicon)
- [ATProto Specifications](https://atproto.com/specs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Type Guards](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

---

**Status**: Phase 5 Complete ✅  
**Impact**: Foundation for eliminating 396 `any` warnings  
**Quality**: 0 linter warnings in type definitions  
**Coverage**: 100+ types defined across ATProto spec
