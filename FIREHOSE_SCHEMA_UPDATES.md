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

2. **Likes Table:**
   - `subject_cid` - CID of the liked post
   - `via` - Optional JSONB field containing {cid, uri} of the item that led to this like (e.g., from a repost)

3. **Reposts Table:**
   - `subject_cid` - CID of the reposted post
   - `via` - Optional JSONB field containing {cid, uri} of the item that led to this repost

## Changes Made

### 1. Database Schema (`shared/schema.ts`)

Updated the Drizzle schema definitions to include the new fields:

```typescript
// Posts table additions:
langs: jsonb('langs'),
parentCid: varchar('parent_cid', { length: 255 }),
rootCid: varchar('root_cid', { length: 255 }),

// Likes table additions:
subjectCid: varchar('subject_cid', { length: 255 }),
via: jsonb('via'),

// Reposts table additions:
subjectCid: varchar('subject_cid', { length: 255 }),
via: jsonb('via'),
```

### 2. Database Migration (`migrations/0001_add_firehose_fields.sql`)

Created a new migration file that:
- Adds the missing columns to the database tables
- Adds comments explaining each field's purpose
- Creates indexes for performance on the new fields:
  - `idx_posts_langs` (GIN index for JSONB)
  - `idx_posts_parent_cid`
  - `idx_posts_root_cid`
  - `idx_likes_subject_cid`
  - `idx_reposts_subject_cid`

### 3. Python Firehose Processing (`python-firehose/unified_worker.py`)

Updated the firehose processing code to extract and store the new fields:

#### Posts Processing
- Extracts `langs` field from record
- Extracts `parent_cid` and `root_cid` from reply.parent and reply.root objects
- Serializes langs as JSONB (handles both string and array values)

#### Likes Processing
- Extracts `subject_cid` from record.subject.cid
- Extracts and serializes `via` field as JSONB with {cid, uri} structure
- Updates all like creation paths including pending operations

#### Reposts Processing
- Extracts `subject_cid` from record.subject.cid
- Extracts and serializes `via` field as JSONB with {cid, uri} structure
- Updates all repost creation paths including pending operations

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
- `app.bsky.feed.getPosts` - includes langs, parent_cid, root_cid
- `app.bsky.feed.getLikes` - includes subject_cid, via
- Other endpoints that return post, like, or repost data

## Performance Considerations

The new indexes ensure that queries filtering or joining on these fields remain performant:
- GIN index on `posts.langs` enables efficient language-based filtering
- B-tree indexes on CID fields support fast lookups in reply thread traversal

## Notes

- All new fields are nullable to maintain backward compatibility
- Existing records will have NULL values for these fields
- New firehose events will populate these fields going forward
- The `via` field is only populated when present in the firehose data (not all likes/reposts have this)
