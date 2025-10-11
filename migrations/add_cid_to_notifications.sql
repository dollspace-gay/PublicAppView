-- Add cid column to notifications table
ALTER TABLE notifications ADD COLUMN cid VARCHAR(255);

-- Add index on cid for better query performance
CREATE INDEX idx_notifications_cid ON notifications(cid);