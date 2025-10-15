-- Migration: Add missing fields from firehose data to database schema
-- This ensures all data from the ATProto firehose can be properly stored and served by the API

-- Add missing fields to posts table
ALTER TABLE posts 
  ADD COLUMN IF NOT EXISTS langs jsonb,
  ADD COLUMN IF NOT EXISTS parent_cid varchar(255),
  ADD COLUMN IF NOT EXISTS root_cid varchar(255);

COMMENT ON COLUMN posts.langs IS 'Language tags from the post (can be array or single string)';
COMMENT ON COLUMN posts.parent_cid IS 'CID of parent post in reply';
COMMENT ON COLUMN posts.root_cid IS 'CID of root post in reply thread';

-- Add missing fields to likes table
ALTER TABLE likes
  ADD COLUMN IF NOT EXISTS subject_cid varchar(255),
  ADD COLUMN IF NOT EXISTS via jsonb;

COMMENT ON COLUMN likes.subject_cid IS 'CID of the liked post (from subject.cid)';
COMMENT ON COLUMN likes.via IS 'Optional: {cid, uri} of item that led to this like (e.g., from a repost)';

-- Add missing fields to reposts table
ALTER TABLE reposts
  ADD COLUMN IF NOT EXISTS subject_cid varchar(255),
  ADD COLUMN IF NOT EXISTS via jsonb;

COMMENT ON COLUMN reposts.subject_cid IS 'CID of the reposted post (from subject.cid)';
COMMENT ON COLUMN reposts.via IS 'Optional: {cid, uri} of item that led to this repost';

-- Create indexes for new fields that may be used for queries
CREATE INDEX IF NOT EXISTS idx_posts_langs ON posts USING gin (langs);
CREATE INDEX IF NOT EXISTS idx_posts_parent_cid ON posts (parent_cid);
CREATE INDEX IF NOT EXISTS idx_posts_root_cid ON posts (root_cid);
CREATE INDEX IF NOT EXISTS idx_likes_subject_cid ON likes (subject_cid);
CREATE INDEX IF NOT EXISTS idx_reposts_subject_cid ON reposts (subject_cid);
