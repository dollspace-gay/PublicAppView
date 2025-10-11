# Data Audit Analysis - Missing Schema Data

## Critical Issues Found

### 1. Missing Post Metadata
**Current**: Basic post data only
**Missing**:
- `violatesThreadGate`: boolean
- `violatesEmbeddingRules`: boolean  
- `hasThreadGate`: boolean
- `hasPostGate`: boolean
- `tags`: Set<string>

### 2. Missing Post Aggregations
**Current**: Hardcoded to 0
**Missing**:
- `replyCount`: number
- `repostCount`: number
- `likeCount`: number

### 3. Missing Viewer State
**Current**: Hardcoded to undefined
**Missing**:
- `like`: string (like URI)
- `repost`: string (repost URI)
- `bookmarked`: boolean
- `threadMuted`: boolean

### 4. Missing Author Information
**Current**: Basic author DID only
**Missing**:
- Author profile data for repost reasons
- Author profile data for pinned post reasons

### 5. Missing Labels
**Current**: Empty array
**Missing**:
- Content labels from labeler services

### 6. Missing Thread Context
**Current**: Not implemented
**Missing**:
- Thread context for replies
- Root author like status

### 7. Missing List-based Blocking
**Current**: Not implemented
**Missing**:
- List-based blocking/muting
- List membership checks

## Required Schema Updates

### 1. Post Table Enhancements
```sql
ALTER TABLE posts ADD COLUMN violates_thread_gate BOOLEAN DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN violates_embedding_rules BOOLEAN DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN has_thread_gate BOOLEAN DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN has_post_gate BOOLEAN DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN tags JSONB DEFAULT '[]';
```

### 2. Post Aggregations Table
```sql
CREATE TABLE post_aggregations (
  post_uri VARCHAR(512) PRIMARY KEY,
  like_count INTEGER DEFAULT 0,
  repost_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Post Viewer States Table
```sql
CREATE TABLE post_viewer_states (
  post_uri VARCHAR(512) NOT NULL,
  viewer_did VARCHAR(255) NOT NULL,
  like_uri VARCHAR(512),
  repost_uri VARCHAR(512),
  bookmarked BOOLEAN DEFAULT FALSE,
  thread_muted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (post_uri, viewer_did)
);
```

### 4. Thread Contexts Table
```sql
CREATE TABLE thread_contexts (
  post_uri VARCHAR(512) PRIMARY KEY,
  root_author_like_uri VARCHAR(512),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Required Event Processor Updates

### 1. Post Processing
- Extract and store thread gate information
- Extract and store post gate information
- Extract and store tags
- Calculate aggregations
- Create thread context

### 2. Like Processing
- Update post aggregations
- Create viewer state records
- Update thread context

### 3. Repost Processing
- Update post aggregations
- Create viewer state records

### 4. Bookmark Processing
- Create viewer state records

### 5. Label Processing
- Store labels for posts
- Update post metadata

## Required XRPC Endpoint Updates

### 1. getAuthorFeed
- Hydrate post aggregations
- Hydrate viewer states
- Hydrate labels
- Hydrate thread contexts

### 2. getTimeline
- Same as getAuthorFeed

### 3. getPostThread
- Hydrate thread context
- Hydrate reply aggregations

### 4. getProfile
- Include pinned post information
- Include aggregations

## Required Redis Updates

### 1. Counter Management
- Add post aggregations counters
- Add viewer state counters
- Add label counters

### 2. Caching
- Cache post aggregations
- Cache viewer states
- Cache labels

## Implementation Priority

### Phase 1: Critical Data
1. Post aggregations (likes, reposts, replies)
2. Viewer states (likes, reposts, bookmarks)
3. Author information for repost/pin reasons

### Phase 2: Advanced Features
1. Thread gates and post gates
2. Labels and moderation
3. List-based blocking

### Phase 3: Performance
1. Caching layer
2. Redis optimization
3. Query optimization