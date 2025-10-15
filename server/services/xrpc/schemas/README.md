# XRPC Schemas

This directory contains all Zod validation schemas for XRPC API endpoints, organized by domain.

## Organization

Schemas are separated into logical domain files for better maintainability:

### Timeline & Posts (`timeline-schemas.ts`)
- Timeline feeds
- Author feeds  
- Post threads
- Likes, reposts, quotes
- V2 thread endpoints

### Actors & Profiles (`actor-schemas.ts`)
- Profile queries
- Follows/followers
- Actor suggestions
- Actor search

### Moderation (`moderation-schemas.ts`)
- Muting actors and threads
- Blocking
- Labels and reports
- List-based moderation

### Social Graph (`graph-schemas.ts`)
- Relationships between actors
- Known followers

### Lists (`list-schemas.ts`)
- List queries
- List feeds
- List membership

### Preferences (`preferences-schemas.ts`)
- User preferences
- Actor preferences

### Notifications (`notification-schemas.ts`)
- Push notifications
- Notification preferences
- Activity subscriptions

### Feed Generators (`feed-generator-schemas.ts`)
- Custom feed queries
- Feed discovery
- Feed suggestions

### Starter Packs (`starter-pack-schemas.ts`)
- Starter pack queries
- Starter pack search
- Starter pack membership

### Search (`search-schemas.ts`)
- Post search

### Utilities (`utility-schemas.ts`)
- Labeler services
- Job status
- Interactions
- Misc endpoints

## Usage

Import schemas from the index file:

```typescript
import {
  getTimelineSchema,
  getProfileSchema,
  muteActorSchema,
} from './xrpc/schemas';
```

Or import from specific domain files:

```typescript
import { getTimelineSchema } from './xrpc/schemas/timeline-schemas';
```

## Migration Status

✅ **Phase 1 Complete**: All schemas extracted from `xrpc-api.ts`
- Total schemas: ~50+ validation schemas
- Organized into 11 domain-specific files
- Centralized export via index.ts

## Benefits

1. **Smaller Files**: Each file ~30-80 lines vs 400+ lines in one file
2. **Clear Organization**: Easy to find schemas by domain
3. **Better Imports**: Import only what you need
4. **Maintainability**: Easier to update and test schemas
5. **Documentation**: Each file has clear purpose and scope
