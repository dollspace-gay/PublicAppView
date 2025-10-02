# AT Protocol AppView Expansion Plan

## Current Implementation Status

### ✅ Already Implemented (37 endpoints - Priority 1 Complete!)

**Feed APIs (9/16)**
- `app.bsky.feed.getTimeline`
- `app.bsky.feed.getAuthorFeed`
- `app.bsky.feed.getPostThread`
- `app.bsky.feed.searchPosts`
- `app.bsky.feed.getPosts` ✨ NEW
- `app.bsky.feed.getLikes` ✨ NEW
- `app.bsky.feed.getRepostedBy` ✨ NEW
- `app.bsky.feed.getQuotes` ✨ NEW
- `app.bsky.feed.getActorLikes` ✨ NEW

**Actor/Profile APIs (7/7)** ✅ COMPLETE
- `app.bsky.actor.getProfile`
- `app.bsky.actor.searchActors`
- `app.bsky.actor.searchActorsTypeahead`
- `app.bsky.actor.getProfiles` ✨ NEW
- `app.bsky.actor.getSuggestions` ✨ NEW
- `app.bsky.actor.getPreferences` ✨ NEW
- `app.bsky.actor.putPreferences` ✨ NEW

**Graph APIs (15/18)**
- `app.bsky.graph.getFollows`
- `app.bsky.graph.getFollowers`
- `app.bsky.graph.getList`
- `app.bsky.graph.getLists`
- `app.bsky.graph.getListFeed`
- `app.bsky.graph.getBlocks` ✨ NEW
- `app.bsky.graph.getMutes` ✨ NEW
- `app.bsky.graph.muteActor` ✨ NEW
- `app.bsky.graph.unmuteActor` ✨ NEW
- `app.bsky.graph.getRelationships` ✨ NEW
- `app.bsky.graph.getListMutes` ✨ NEW
- `app.bsky.graph.getListBlocks` ✨ NEW
- `app.bsky.graph.getKnownFollowers` ✨ NEW
- `app.bsky.graph.getSuggestedFollowsByActor` ✨ NEW
- `app.bsky.graph.muteActorList` ✨ NEW
- `app.bsky.graph.unmuteActorList` ✨ NEW

**Notification APIs (3/5)**
- `app.bsky.notification.listNotifications`
- `app.bsky.notification.getUnreadCount`
- `app.bsky.notification.updateSeen`

**Moderation APIs (2/2)** ✅ COMPLETE
- `com.atproto.label.queryLabels`
- `app.bsky.moderation.createReport`

---

## ✅ Priority 1: Core Social Features (COMPLETE!)

### 1. Post Interaction Endpoints
**Business Value**: Enable users to see engagement metrics and discover related content
**Complexity**: Low-Medium

#### Endpoints to Build:
- `app.bsky.feed.getPosts` - Get multiple posts by URI (batch fetching)
- `app.bsky.feed.getLikes` - Get users who liked a post
- `app.bsky.feed.getRepostedBy` - Get users who reposted
- `app.bsky.feed.getQuotes` - Get quote posts of a post
- `app.bsky.feed.getActorLikes` - Get posts liked by an actor

#### Implementation Plan:
1. **Database**: Already have `likes`, `reposts` tables with proper indexes
2. **Storage Layer**: Add methods to `IStorage`:
   - `getPostsByUris(uris: string[]): Promise<Post[]>`
   - `getLikesForPost(postUri: string, limit?: number, cursor?: string): Promise<{likes: Like[], cursor?: string}>`
   - `getRepostsForPost(postUri: string, ...): Promise<{reposts: Repost[], ...}>`
   - `getQuotesForPost(postUri: string, ...): Promise<{posts: Post[], ...}>`
   - `getLikesByActor(did: string, ...): Promise<{likes: Like[], ...}>`
3. **XRPC API**: Implement in `xrpc-api.ts` following existing patterns
4. **Routes**: Register endpoints in `routes.ts`

**Estimated Effort**: 4-6 hours

---

### 2. Advanced Profile Features
**Business Value**: Rich profile views and discovery
**Complexity**: Low-Medium

#### Endpoints to Build:
- `app.bsky.actor.getProfiles` - Batch get multiple profiles
- `app.bsky.actor.getSuggestions` - Suggest accounts to follow
- `app.bsky.actor.getPreferences` - Get user preferences (auth required)
- `app.bsky.actor.putPreferences` - Update user preferences (auth required)

#### Implementation Plan:
1. **Database Schema**: Add `user_preferences` table
   ```sql
   CREATE TABLE user_preferences (
     user_did VARCHAR PRIMARY KEY REFERENCES users(did),
     adult_content BOOLEAN DEFAULT false,
     content_labels JSONB,
     feed_view_prefs JSONB,
     updated_at TIMESTAMP DEFAULT NOW()
   )
   ```
2. **Suggestions Algorithm**: 
   - Based on mutual follows (friends-of-friends)
   - Popular accounts in same topics/hashtags
   - New accounts with engagement
3. **Storage Layer**: Add preference CRUD methods
4. **XRPC Implementation**: Follow auth patterns from existing endpoints

**Estimated Effort**: 6-8 hours

---

### 3. Enhanced Graph Features
**Business Value**: Complete social graph navigation and moderation
**Complexity**: Medium

#### Endpoints to Build:
- `app.bsky.graph.getBlocks` - Get blocked accounts (auth required)
- `app.bsky.graph.getMutes` - Get muted accounts (auth required)
- `app.bsky.graph.muteActor` - Mute an actor (auth required)
- `app.bsky.graph.unmuteActor` - Unmute an actor (auth required)
- `app.bsky.graph.muteActorList` - Mute a list (auth required)
- `app.bsky.graph.unmuteActorList` - Unmute a list (auth required)
- `app.bsky.graph.getListBlocks` - Get blocked mod lists
- `app.bsky.graph.getListMutes` - Get muted lists
- `app.bsky.graph.getRelationships` - Get relationships between actors
- `app.bsky.graph.getSuggestedFollowsByActor` - Get suggested follows
- `app.bsky.graph.getKnownFollowers` - Get known followers

#### Implementation Plan:
1. **Database Schema**: Add `mutes` table and list mute/block tables
   ```sql
   CREATE TABLE mutes (
     uri VARCHAR PRIMARY KEY,
     muter_did VARCHAR REFERENCES users(did),
     muted_did VARCHAR REFERENCES users(did),
     created_at TIMESTAMP DEFAULT NOW()
   )
   
   CREATE TABLE list_mutes (
     uri VARCHAR PRIMARY KEY,
     muter_did VARCHAR REFERENCES users(did),
     list_uri VARCHAR REFERENCES lists(uri),
     created_at TIMESTAMP
   )
   ```
2. **Firehose Processing**: Add handlers for `app.bsky.graph.mute` records
3. **Relationships API**: Compute bi-directional relationships (following, followers, mutes, blocks)
4. **Storage Layer**: Full CRUD for mute operations
5. **Known Followers**: Intersection of followers and follows

**Estimated Effort**: 8-10 hours

---

## 🎯 Priority 2: Feed Generators & Discovery (Medium Value)

### 4. Feed Generator Support
**Business Value**: Enable custom algorithmic feeds
**Complexity**: High

#### Endpoints to Build:
- `app.bsky.feed.getFeed` - Get feed from a feed generator
- `app.bsky.feed.getFeedGenerator` - Get feed generator info
- `app.bsky.feed.getFeedGenerators` - Get multiple feed generators
- `app.bsky.feed.describeFeedGenerator` - Describe capabilities
- `app.bsky.feed.getActorFeeds` - Get feeds created by an actor
- `app.bsky.feed.getSuggestedFeeds` - Get suggested feeds

#### Implementation Plan:
1. **Database Schema**: Add `feed_generators` table
   ```sql
   CREATE TABLE feed_generators (
     uri VARCHAR PRIMARY KEY,
     cid VARCHAR NOT NULL,
     creator_did VARCHAR REFERENCES users(did),
     did VARCHAR NOT NULL, -- Service DID
     display_name VARCHAR,
     description TEXT,
     avatar_url TEXT,
     created_at TIMESTAMP
   )
   ```
2. **Firehose Processing**: Handle `app.bsky.feed.generator` records
3. **Feed Skeleton Hydration**: 
   - Call external feed generator service
   - Receive skeleton (list of post URIs)
   - Hydrate with full post data from our DB
4. **JWT Authentication**: Sign requests to feed generators
5. **Caching**: Cache feed results with TTL

**Estimated Effort**: 12-16 hours

---

### 5. Starter Packs
**Business Value**: Onboarding and discovery
**Complexity**: Medium

#### Endpoints to Build:
- `app.bsky.graph.getStarterPack` - Get specific starter pack
- `app.bsky.graph.getStarterPacks` - Get multiple starter packs

#### Implementation Plan:
1. **Database Schema**: Add `starter_packs` table
   ```sql
   CREATE TABLE starter_packs (
     uri VARCHAR PRIMARY KEY,
     cid VARCHAR NOT NULL,
     creator_did VARCHAR REFERENCES users(did),
     name VARCHAR,
     description TEXT,
     list_uri VARCHAR REFERENCES lists(uri),
     feeds JSONB, -- Array of feed URIs
     created_at TIMESTAMP
   )
   ```
2. **Firehose Processing**: Handle `app.bsky.graph.starterpack` records
3. **Storage & API**: Standard CRUD pattern

**Estimated Effort**: 4-6 hours

---

## 🎯 Priority 3: Advanced Features (Lower Priority)

### 6. Video Support
**Business Value**: Multimedia content support
**Complexity**: High

#### Endpoints to Build:
- `app.bsky.video.getJobStatus` - Get video processing status
- `app.bsky.video.getUploadLimits` - Get upload limits

#### Implementation Plan:
1. **Database Schema**: Add `video_jobs` table for processing status
2. **Storage Integration**: Connect to object storage for video files
3. **Processing Pipeline**: Integration with video transcoding service
4. **Embed Support**: Handle `app.bsky.embed.video` in posts

**Estimated Effort**: 20-30 hours (depends on infrastructure)

---

### 7. Experimental/Unspecced APIs
**Business Value**: Nice-to-have discovery features
**Complexity**: Medium

#### Endpoints to Build:
- `app.bsky.unspecced.getPopularFeedGenerators`
- `app.bsky.unspecced.getTaggedSuggestions`
- `app.bsky.unspecced.getSuggestionsSkeleton`
- `app.bsky.unspecced.searchActorsSkeleton`
- `app.bsky.unspecced.searchPostsSkeleton`

#### Implementation Plan:
1. These are experimental and may change
2. Implement only if needed for specific use cases
3. Follow Bluesky's implementation as reference

**Estimated Effort**: 6-10 hours

---

### 8. Enhanced Notification Features
**Business Value**: Better notification management
**Complexity**: Low

#### Endpoints to Build:
- `app.bsky.notification.registerPush` - Register push notifications
- `app.bsky.notification.putPreferences` - Update notification preferences

#### Implementation Plan:
1. **Database Schema**: Add `push_subscriptions` table
2. **Push Integration**: Integrate with push notification service (FCM, APNs)
3. **Preferences**: Store per-user notification settings

**Estimated Effort**: 6-8 hours

---

### 9. Labeler Services
**Business Value**: Enhanced moderation capabilities
**Complexity**: Medium-High

#### Endpoints to Build:
- `app.bsky.labeler.getServices` - Get labeler services

#### Implementation Plan:
1. **Schema**: Add `labeler_services` table
2. **DID Resolution**: Resolve labeler service DIDs
3. **Label Subscription**: Subscribe to external labelers
4. **Label Application**: Apply external labels to content

**Estimated Effort**: 10-14 hours

---

## 📊 Implementation Roadmap

### Phase 1 (Weeks 1-2): Core Social Features
**Goal**: Complete social interaction features
- Post interactions (likes, reposts, quotes)
- Advanced profile features
- Enhanced graph features
**Total Effort**: ~20-24 hours

### Phase 2 (Weeks 3-4): Discovery & Feeds
**Goal**: Enable custom feeds and discovery
- Feed generator support
- Starter packs
- Suggestions & discovery
**Total Effort**: ~18-24 hours

### Phase 3 (Weeks 5-6): Advanced Features
**Goal**: Multimedia and experimental features
- Video support (if needed)
- Push notifications
- Experimental APIs
**Total Effort**: ~30-40+ hours (depending on scope)

### Phase 4 (Ongoing): Labeler Integration
**Goal**: Enhanced moderation
- External labeler support
- Custom labeling services
**Total Effort**: ~10-14 hours

---

## 🔧 Technical Considerations

### Database Migrations
- Use Drizzle Kit for all schema changes
- Run `npm run db:push` to apply changes
- Test migrations on development database first

### Performance Optimization
- Add indexes for all foreign keys and frequently queried fields
- Implement cursor-based pagination for all list endpoints
- Use connection pooling efficiently (already configured)
- Cache frequently accessed data (feed results, popular content)

### Testing Strategy
- Add API endpoint tests for each new endpoint
- Test with real firehose data in development
- Load test high-traffic endpoints (feeds, timelines)
- Verify cursor pagination works correctly

### Security
- Require authentication for sensitive endpoints (mutes, blocks, preferences)
- Validate all user input with Zod schemas
- Rate limit expensive operations
- Sanitize user-generated content

### Monitoring
- Track endpoint performance metrics (already implemented)
- Monitor database query performance
- Alert on error rate spikes
- Track cache hit rates for feeds

---

## 💡 Nice-to-Have Enhancements

1. **Trending Topics**: Analyze hashtags and surface trending content
2. **Analytics Dashboard**: Show feed performance, engagement metrics
3. **A/B Testing**: Compare feed algorithms
4. **Spam Detection**: ML-based spam filtering
5. **Content Recommendations**: Personalized content suggestions
6. **Export Tools**: Allow users to export their data
7. **Backup/Restore**: Point-in-time recovery for user data

---

## 📚 Resources

- **Official Docs**: https://docs.bsky.app/
- **AT Protocol Specs**: https://atproto.com/
- **Lexicon Definitions**: https://github.com/bluesky-social/atproto/tree/main/lexicons
- **Python SDK**: https://atproto.blue/
- **Community Wiki**: https://atproto.wiki/

---

## Summary

**Current Coverage**: 17/60+ endpoints (~28%)

**Priority 1 Additions**: +16 endpoints (Core social features)
**Priority 2 Additions**: +8 endpoints (Feed generators & discovery)
**Priority 3 Additions**: +10+ endpoints (Advanced features)

**Target Coverage**: 50+ endpoints (~80% of core Bluesky functionality)

The plan focuses on high-value social features first, then discovery and feeds, and finally advanced multimedia features. This gives users a fully-functional AppView while maintaining implementation quality and system performance.
