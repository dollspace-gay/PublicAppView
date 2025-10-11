-- Add feed_items table for tracking different types of content in feeds
CREATE TABLE IF NOT EXISTS feed_items (
  uri VARCHAR(512) PRIMARY KEY,
  post_uri VARCHAR(512) NOT NULL,
  originator_did VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL,
  sort_at TIMESTAMP NOT NULL,
  cid VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add indexes for feed_items
CREATE INDEX IF NOT EXISTS idx_feed_items_originator ON feed_items(originator_did);
CREATE INDEX IF NOT EXISTS idx_feed_items_post ON feed_items(post_uri);
CREATE INDEX IF NOT EXISTS idx_feed_items_sort_at ON feed_items(sort_at);
CREATE INDEX IF NOT EXISTS idx_feed_items_type ON feed_items(type);
CREATE INDEX IF NOT EXISTS idx_feed_items_originator_sort ON feed_items(originator_did, sort_at);

-- Add pinned_post column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned_post JSONB;

-- Populate feed_items with existing posts
INSERT INTO feed_items (uri, post_uri, originator_did, type, sort_at, cid, created_at)
SELECT 
  uri as uri,
  uri as post_uri,
  author_did as originator_did,
  'post' as type,
  created_at as sort_at,
  cid as cid,
  created_at as created_at
FROM posts
WHERE NOT EXISTS (SELECT 1 FROM feed_items WHERE feed_items.uri = posts.uri);

-- Populate feed_items with existing reposts
INSERT INTO feed_items (uri, post_uri, originator_did, type, sort_at, cid, created_at)
SELECT 
  uri as uri,
  post_uri as post_uri,
  user_did as originator_did,
  'repost' as type,
  created_at as sort_at,
  uri as cid, -- Using repost URI as CID for now
  created_at as created_at
FROM reposts
WHERE NOT EXISTS (SELECT 1 FROM feed_items WHERE feed_items.uri = reposts.uri);