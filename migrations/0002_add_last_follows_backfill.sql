-- Add lastFollowsBackfill column to user_settings table
ALTER TABLE user_settings ADD COLUMN last_follows_backfill TIMESTAMP;
