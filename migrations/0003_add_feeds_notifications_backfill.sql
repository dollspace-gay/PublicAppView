-- Add timestamp columns for feeds and notifications backfill tracking
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS last_feeds_backfill TIMESTAMP;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS last_notifications_backfill TIMESTAMP;
