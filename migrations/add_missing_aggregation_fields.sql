-- Migration: Add missing aggregation and viewer state fields
-- Date: December 2024
-- Description: Adds bookmarkCount, quoteCount, and viewer state fields

-- Add missing fields to post_aggregations table
ALTER TABLE post_aggregations 
ADD COLUMN IF NOT EXISTS bookmark_count INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS quote_count INTEGER DEFAULT 0 NOT NULL;

-- Add indexes for new aggregation fields
CREATE INDEX IF NOT EXISTS idx_post_aggregations_bookmark_count ON post_aggregations(bookmark_count);
CREATE INDEX IF NOT EXISTS idx_post_aggregations_quote_count ON post_aggregations(quote_count);

-- Add missing fields to post_viewer_states table
ALTER TABLE post_viewer_states 
ADD COLUMN IF NOT EXISTS reply_disabled BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS embedding_disabled BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE NOT NULL;

-- Update existing records to have default values
UPDATE post_aggregations 
SET bookmark_count = 0, quote_count = 0 
WHERE bookmark_count IS NULL OR quote_count IS NULL;

UPDATE post_viewer_states 
SET reply_disabled = FALSE, embedding_disabled = FALSE, pinned = FALSE 
WHERE reply_disabled IS NULL OR embedding_disabled IS NULL OR pinned IS NULL;