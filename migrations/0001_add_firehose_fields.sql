-- Migration: Add missing fields from firehose data to database schema
-- This ensures all data from the ATProto firehose can be properly stored and served by the API

-- Add missing fields to posts table
ALTER TABLE posts 
  ADD COLUMN IF NOT EXISTS langs jsonb,
  ADD COLUMN IF NOT EXISTS parent_cid varchar(255),
  ADD COLUMN IF NOT EXISTS root_cid varchar(255),
  ADD COLUMN IF NOT EXISTS commit_time timestamp,
  ADD COLUMN IF NOT EXISTS commit_seq varchar(32),
  ADD COLUMN IF NOT EXISTS commit_rev varchar(64);

COMMENT ON COLUMN posts.langs IS 'Language tags from the post (can be array or single string)';
COMMENT ON COLUMN posts.parent_cid IS 'CID of parent post in reply';
COMMENT ON COLUMN posts.root_cid IS 'CID of root post in reply thread';
COMMENT ON COLUMN posts.commit_time IS 'Time from the firehose commit event';
COMMENT ON COLUMN posts.commit_seq IS 'Sequence number from firehose for ordering and replay';
COMMENT ON COLUMN posts.commit_rev IS 'Revision identifier from the commit';

-- Add missing fields to likes table
ALTER TABLE likes
  ADD COLUMN IF NOT EXISTS subject_cid varchar(255),
  ADD COLUMN IF NOT EXISTS via jsonb,
  ADD COLUMN IF NOT EXISTS commit_time timestamp,
  ADD COLUMN IF NOT EXISTS commit_seq varchar(32),
  ADD COLUMN IF NOT EXISTS commit_rev varchar(64);

COMMENT ON COLUMN likes.subject_cid IS 'CID of the liked post (from subject.cid)';
COMMENT ON COLUMN likes.via IS 'Optional: {cid, uri} of item that led to this like (e.g., from a repost)';
COMMENT ON COLUMN likes.commit_time IS 'Time from the firehose commit event';
COMMENT ON COLUMN likes.commit_seq IS 'Sequence number from firehose for ordering and replay';
COMMENT ON COLUMN likes.commit_rev IS 'Revision identifier from the commit';

-- Add missing fields to reposts table
ALTER TABLE reposts
  ADD COLUMN IF NOT EXISTS subject_cid varchar(255),
  ADD COLUMN IF NOT EXISTS via jsonb,
  ADD COLUMN IF NOT EXISTS commit_time timestamp,
  ADD COLUMN IF NOT EXISTS commit_seq varchar(32),
  ADD COLUMN IF NOT EXISTS commit_rev varchar(64);

COMMENT ON COLUMN reposts.subject_cid IS 'CID of the reposted post (from subject.cid)';
COMMENT ON COLUMN reposts.via IS 'Optional: {cid, uri} of item that led to this repost';
COMMENT ON COLUMN reposts.commit_time IS 'Time from the firehose commit event';
COMMENT ON COLUMN reposts.commit_seq IS 'Sequence number from firehose for ordering and replay';
COMMENT ON COLUMN reposts.commit_rev IS 'Revision identifier from the commit';

-- Add commit metadata to follows table
ALTER TABLE follows
  ADD COLUMN IF NOT EXISTS commit_time timestamp,
  ADD COLUMN IF NOT EXISTS commit_seq varchar(32),
  ADD COLUMN IF NOT EXISTS commit_rev varchar(64);

COMMENT ON COLUMN follows.commit_time IS 'Time from the firehose commit event';
COMMENT ON COLUMN follows.commit_seq IS 'Sequence number from firehose for ordering and replay';
COMMENT ON COLUMN follows.commit_rev IS 'Revision identifier from the commit';

-- Add commit metadata to blocks table
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS commit_time timestamp,
  ADD COLUMN IF NOT EXISTS commit_seq varchar(32),
  ADD COLUMN IF NOT EXISTS commit_rev varchar(64);

COMMENT ON COLUMN blocks.commit_time IS 'Time from the firehose commit event';
COMMENT ON COLUMN blocks.commit_seq IS 'Sequence number from firehose for ordering and replay';
COMMENT ON COLUMN blocks.commit_rev IS 'Revision identifier from the commit';

-- Create indexes for new fields that may be used for queries
CREATE INDEX IF NOT EXISTS idx_posts_langs ON posts USING gin (langs);
CREATE INDEX IF NOT EXISTS idx_posts_parent_cid ON posts (parent_cid);
CREATE INDEX IF NOT EXISTS idx_posts_root_cid ON posts (root_cid);
CREATE INDEX IF NOT EXISTS idx_posts_commit_seq ON posts (commit_seq);
CREATE INDEX IF NOT EXISTS idx_posts_commit_time ON posts (commit_time);
CREATE INDEX IF NOT EXISTS idx_likes_subject_cid ON likes (subject_cid);
CREATE INDEX IF NOT EXISTS idx_likes_commit_seq ON likes (commit_seq);
CREATE INDEX IF NOT EXISTS idx_reposts_subject_cid ON reposts (subject_cid);
CREATE INDEX IF NOT EXISTS idx_reposts_commit_seq ON reposts (commit_seq);
CREATE INDEX IF NOT EXISTS idx_follows_commit_seq ON follows (commit_seq);
CREATE INDEX IF NOT EXISTS idx_blocks_commit_seq ON blocks (commit_seq);
