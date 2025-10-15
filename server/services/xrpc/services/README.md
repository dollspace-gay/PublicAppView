# XRPC Services

This directory contains service modules extracted from the monolithic `xrpc-api.ts` file, organized by functional domain.

## Phase 3 Progress: Service Extraction

**Status**: 🚧 In Progress - Starting with simple services

### Completed Services (3/11 planned)

✅ **Bookmark Service** (`bookmark-service.ts` - 164 lines)
- `createBookmark` - Create a new bookmark
- `deleteBookmark` - Delete a bookmark  
- `getBookmarks` - List user's bookmarks

✅ **Search Service** (`search-service.ts` - 152 lines)
- `searchPosts` - Search for posts
- `searchActors` - Search for users
- `searchActorsTypeahead` - Typeahead search for users
- `searchStarterPacks` - Search for starter packs

✅ **Utility Service** (`utility-service.ts` - 240 lines)
- `getServices` - Get labeler services
- `getJobStatus` - Get video job status
- `getUploadLimits` - Get video upload limits
- `sendInteractions` - Send user interactions

### Remaining Services (8/11)

**Next Priority (Medium Complexity)**:
- 🔜 **Notification Service** - Push notifications, preferences
- 🔜 **Preferences Service** - User preferences management
- 🔜 **Starter Pack Service** - Starter pack operations

**Later (Higher Complexity)**:
- ⏳ **Timeline Service** - Timeline feeds, author feeds, post threads
- ⏳ **Actor Service** - Profiles, follows, suggestions
- ⏳ **Graph Service** - Social relationships, known followers
- ⏳ **Moderation Service** - Muting, blocking, reporting
- ⏳ **Feed Generator Service** - Custom feeds, feed discovery

## Service Module Pattern

Each service module follows a consistent pattern:

```typescript
/**
 * [Service Name] Service
 * [Description of service responsibilities]
 */

import type { Request, Response } from 'express';
import { storage } from '../../storage';
import { requireAuthDid, getAuthenticatedDid } from '../utils/auth-helpers';
import { handleError } from '../utils/error-handler';
import { schemaName } from '../schemas';

/**
 * [Endpoint Name]
 * [HTTP Method] /xrpc/[namespace].[method]
 */
export async function endpointName(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // 1. Validate input
    const params = schemaName.parse(req.query || req.body);
    
    // 2. Authenticate if needed
    const userDid = await requireAuthDid(req, res);
    if (!userDid) return;
    
    // 3. Business logic
    const result = await storage.someOperation(...);
    
    // 4. Return response
    res.json(result);
  } catch (error) {
    handleError(res, error, 'endpointName');
  }
}
```

## Design Principles

### 1. Single Responsibility
Each service handles one domain (bookmarks, search, etc.)

### 2. Pure Functions
Service functions are stateless and side-effect free (except I/O)

### 3. Type Safety
- Use TypeScript types where possible
- `unknown` instead of `any` for dynamic data
- Proper type guards and assertions

### 4. Error Handling
- Centralized error handling via `handleError`
- Consistent error responses
- Proper HTTP status codes

### 5. Authentication
- Use `requireAuthDid` for protected endpoints
- Use `getAuthenticatedDid` for optional auth
- Clear authentication flow

### 6. Validation
- All inputs validated with Zod schemas
- Schemas imported from `../schemas`
- Consistent validation pattern

## Usage

### Import from service index:
```typescript
import {
  createBookmark,
  searchPosts,
  getServices,
} from './services/xrpc/services';
```

### Or import from specific service:
```typescript
import { createBookmark } from './services/xrpc/services/bookmark-service';
```

## Migration from xrpc-api.ts

### Before (Monolithic)
```typescript
class XRPCApi {
  async createBookmark(req: Request, res: Response) {
    // ... implementation using this.requireAuthDid, this._handleError, etc.
  }
}
```

### After (Modular)
```typescript
export async function createBookmark(
  req: Request,
  res: Response
): Promise<void> {
  // ... implementation using imported utilities
}
```

### Key Changes
1. **From class methods to standalone functions**
   - No more `this` references
   - Explicit imports for dependencies

2. **From private methods to imported utilities**
   - `this.requireAuthDid` → `requireAuthDid` from utils
   - `this._handleError` → `handleError` from utils
   - `this.serializePosts` → `serializePosts` local or from utils

3. **Clearer dependencies**
   - All imports at top of file
   - Easy to see what each service depends on

## Testing Strategy

Each service can be tested independently:

```typescript
import { createBookmark } from './bookmark-service';

describe('Bookmark Service', () => {
  it('should create a bookmark', async () => {
    const req = mockRequest({ body: { ... } });
    const res = mockResponse();
    
    await createBookmark(req, res);
    
    expect(res.json).toHaveBeenCalledWith({ uri: '...' });
  });
});
```

## Benefits

### Completed So Far
1. ✅ **Better Organization** - Services grouped by domain
2. ✅ **Smaller Files** - 150-250 lines vs 4,734 in one file
3. ✅ **Independent Testing** - Can test each service in isolation
4. ✅ **Clear Dependencies** - Explicit imports show what's needed
5. ✅ **Type Safety** - Proper TypeScript types throughout
6. ✅ **Zero Linter Warnings** - All new code is clean

### Once Complete (Phase 3 Done)
7. 🎯 All ~77 endpoints extracted into focused services
8. 🎯 Original `xrpc-api.ts` can be deprecated
9. 🎯 Easy to add new endpoints to appropriate services
10. 🎯 Better code splitting and performance
11. 🎯 Parallel development across services

## Statistics

### Current Progress
- **Services Created**: 3 / 11 planned
- **Endpoints Extracted**: 11 endpoints
- **Lines of Code**: 583 lines (avg 145 lines/service)
- **Linter Warnings**: 0 (all clean!)

### Remaining Work
- **Services To Create**: 8
- **Endpoints To Extract**: ~66 endpoints
- **Estimated Lines**: ~1,500-2,500 lines

---

**Note**: Original `xrpc-api.ts` (4,734 lines) remains unchanged for backward compatibility until Phase 3 is complete.
