# Firehose Data Schema Updates

**Date:** 2025-10-15  
**Status:** ✅ Complete

## Overview

After analyzing the example firehose data from the AT Protocol, several fields were identified as missing from the database schema. This document outlines the changes made to ensure all data from the firehose can be properly stored and served by the API.

## Missing Fields Identified

### From Firehose Data Analysis

Based on the provided firehose examples, the following fields were missing:

1. **Posts Table:**
   - `langs` - Language tags (can be array or single string)
   - `parent_cid` - CID of parent post in reply threads
   - `root_cid` - CID of root post in reply threads
   - `commit_time` - Timestamp from the commit event
   - `commit_seq` - Sequence number from the firehose
   - `commit_rev` - Revision identifier from the commit

2. **Likes Table:**
   - `subject_cid` - CID of the liked post
   - `via` - Optional JSONB field containing {cid, uri} of the item that led to this like (e.g., from a repost)
   - `commit_time` - Timestamp from the commit event
   - `commit_seq` - Sequence number from the firehose
   - `commit_rev` - Revision identifier from the commit

3. **Reposts Table:**
   - `subject_cid` - CID of the reposted post
   - `via` - Optional JSONB field containing {cid, uri} of the item that led to this repost
   - `commit_time` - Timestamp from the commit event
   - `commit_seq` - Sequence number from the firehose
   - `commit_rev` - Revision identifier from the commit

4. **Follows Table:**
   - `commit_time` - Timestamp from the commit event
   - `commit_seq` - Sequence number from the firehose
   - `commit_rev` - Revision identifier from the commit

5. **Blocks Table:**
   - `commit_time` - Timestamp from the commit event
   - `commit_seq` - Sequence number from the firehose
   - `commit_rev` - Revision identifier from the commit

## Changes Made

### 1. Database Schema (`shared/schema.ts`)

Updated the Drizzle schema definitions to include the new fields:

```typescript
// Posts table additions:
langs: jsonb('langs'),
parentCid: varchar('parent_cid', { length: 255 }),
rootCid: varchar('root_cid', { length: 255 }),
commitTime: timestamp('commit_time'),
commitSeq: varchar('commit_seq', { length: 32 }),
commitRev: varchar('commit_rev', { length: 64 }),

// Likes table additions:
subjectCid: varchar('subject_cid', { length: 255 }),
via: jsonb('via'),
commitTime: timestamp('commit_time'),
commitSeq: varchar('commit_seq', { length: 32 }),
commitRev: varchar('commit_rev', { length: 64 }),

// Reposts table additions:
subjectCid: varchar('subject_cid', { length: 255 }),
via: jsonb('via'),
commitTime: timestamp('commit_time'),
commitSeq: varchar('commit_seq', { length: 32 }),
commitRev: varchar('commit_rev', { length: 64 }),

// Follows table additions:
commitTime: timestamp('commit_time'),
commitSeq: varchar('commit_seq', { length: 32 }),
commitRev: varchar('commit_rev', { length: 64 }),

// Blocks table additions:
commitTime: timestamp('commit_time'),
commitSeq: varchar('commit_seq', { length: 32 }),
commitRev: varchar('commit_rev', { length: 64 }),
```

### 2. Database Migration (`migrations/0001_add_firehose_fields.sql`)

Created a new migration file that:
- Adds the missing columns to the database tables
- Adds comments explaining each field's purpose
- Creates indexes for performance on the new fields:
  - `idx_posts_langs` (GIN index for JSONB)
  - `idx_posts_parent_cid`
  - `idx_posts_root_cid`
  - `idx_posts_commit_seq`
  - `idx_posts_commit_time`
  - `idx_likes_subject_cid`
  - `idx_likes_commit_seq`
  - `idx_reposts_subject_cid`
  - `idx_reposts_commit_seq`
  - `idx_follows_commit_seq`
  - `idx_blocks_commit_seq`

### 3. Python Firehose Processing (`python-firehose/unified_worker.py`)

Updated the firehose processing code to extract and store the new fields:

#### Posts Processing
- Extracts `langs` field from record
- Extracts `parent_cid` and `root_cid` from reply.parent and reply.root objects
- Extracts commit metadata (`commit.time`, `commit.seq`, `commit.rev`) from commit event
- Serializes langs as JSONB (handles both string and array values)

#### Likes Processing
- Extracts `subject_cid` from record.subject.cid
- Extracts and serializes `via` field as JSONB with {cid, uri} structure
- Extracts commit metadata (`commit.time`, `commit.seq`, `commit.rev`) from commit event
- Updates all like creation paths including pending operations

#### Reposts Processing
- Extracts `subject_cid` from record.subject.cid
- Extracts and serializes `via` field as JSONB with {cid, uri} structure
- Extracts commit metadata (`commit.time`, `commit.seq`, `commit.rev`) from commit event
- Updates all repost creation paths including pending operations

#### Follows Processing
- Extracts commit metadata (`commit.time`, `commit.seq`, `commit.rev`) from commit event
- Updates all follow creation paths

#### Blocks Processing
- Extracts commit metadata (`commit.time`, `commit.seq`, `commit.rev`) from commit event
- Updates all block creation paths

## Implementation Details

### Via Field Structure

The `via` field is stored as JSONB with the following structure:
```json
{
  "cid": "bafyrei...",
  "uri": "at://did:plc:.../app.bsky.feed.repost/..."
}
```

This field indicates the item that led a user to discover and interact with the content (e.g., they liked a post after seeing it in a repost).

### Langs Field Structure

The `langs` field is stored as JSONB array:
```json
["en"]
```
or
```json
["en", "es"]
```

Even if the original record has a single string, it's normalized to an array for consistency.

## Migration Instructions

To apply these changes to your database:

```bash
# Run the migration
psql $DATABASE_URL < migrations/0001_add_firehose_fields.sql
```

Or using Drizzle:

```bash
npm run drizzle-kit push
```

## Testing

After applying the migration, verify that:

1. The new columns exist in the database
2. The indexes are created
3. The firehose consumer can write to the new fields
4. The API can query and serve the new fields

## API Impact

All new fields are now available for querying and will be included in API responses for:
- `app.bsky.feed.getPosts` - includes langs, parent_cid, root_cid, commit metadata
- `app.bsky.feed.getLikes` - includes subject_cid, via, commit metadata
- `app.bsky.graph.getFollows` - includes commit metadata
- Other endpoints that return post, like, repost, follow, or block data

The commit metadata enables new API capabilities:
- Ordering by firehose sequence instead of creation time
- Filtering by commit time ranges
- Replay/sync operations from specific sequence numbers

## Commit Metadata

The commit event metadata is crucial for:

1. **Event Ordering**: `commit_seq` provides a global sequence number for ordering events across all repos
2. **Event Timing**: `commit_time` shows when the event actually occurred on the network (vs `createdAt` which is from the record)
3. **Revision Tracking**: `commit_rev` helps track revisions for conflict resolution and debugging
4. **Replay Capability**: The sequence number enables replaying the firehose from a specific point

### Timestamp Differences

Each record now has two timestamps:
- `created_at` - When the user created the record (from the record itself)
- `commit_time` - When the commit event occurred on the firehose

These can differ slightly due to network propagation delays.

## Performance Considerations

The new indexes ensure that queries filtering or joining on these fields remain performant:
- GIN index on `posts.langs` enables efficient language-based filtering
- B-tree indexes on CID fields support fast lookups in reply thread traversal
- B-tree indexes on `commit_seq` enable efficient ordering by firehose sequence
- B-tree indexes on `commit_time` support temporal queries based on commit time

## Notes

- All new fields are nullable to maintain backward compatibility
- Existing records will have NULL values for these fields
- New firehose events will populate these fields going forward
- The `via` field is only populated when present in the firehose data (not all likes/reposts have this)
