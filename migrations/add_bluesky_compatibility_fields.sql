-- Migration to add Bluesky compatibility fields
-- This adds missing fields to match Bluesky's data structure

-- Add missing fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_cid VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_takedown_ref VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS sorted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS takedown_ref VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_labeler BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_incoming_chats_from VARCHAR(50) DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS upstream_status VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS priority_notifications BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_verifier BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_activity_subscriptions_from VARCHAR(50) DEFAULT 'none';

-- Add indexes for new fields
CREATE INDEX IF NOT EXISTS idx_users_sorted_at ON users(sorted_at);
CREATE INDEX IF NOT EXISTS idx_users_is_labeler ON users(is_labeler);
CREATE INDEX IF NOT EXISTS idx_users_trusted_verifier ON users(trusted_verifier);

-- Create verifications table
CREATE TABLE IF NOT EXISTS verifications (
  uri VARCHAR(512) PRIMARY KEY,
  cid VARCHAR(255) NOT NULL,
  issuer_did VARCHAR(255) NOT NULL,
  subject_did VARCHAR(255) NOT NULL,
  handle VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add indexes for verifications
CREATE INDEX IF NOT EXISTS idx_verifications_subject_did ON verifications(subject_did);
CREATE INDEX IF NOT EXISTS idx_verifications_issuer_did ON verifications(issuer_did);
CREATE INDEX IF NOT EXISTS idx_verifications_created_at ON verifications(created_at);

-- Create activity subscriptions table
CREATE TABLE IF NOT EXISTS activity_subscriptions (
  subject_did VARCHAR(255) NOT NULL,
  subscriber_did VARCHAR(255) NOT NULL,
  post BOOLEAN DEFAULT FALSE NOT NULL,
  reply BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  PRIMARY KEY (subject_did, subscriber_did)
);

-- Add indexes for activity subscriptions
CREATE INDEX IF NOT EXISTS idx_activity_subscriptions_subject ON activity_subscriptions(subject_did);
CREATE INDEX IF NOT EXISTS idx_activity_subscriptions_subscriber ON activity_subscriptions(subscriber_did);

-- Create status table
CREATE TABLE IF NOT EXISTS statuses (
  uri VARCHAR(512) PRIMARY KEY,
  cid VARCHAR(255) NOT NULL,
  author_did VARCHAR(255) NOT NULL,
  status VARCHAR(100) NOT NULL,
  record JSONB NOT NULL,
  embed JSONB,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add indexes for statuses
CREATE INDEX IF NOT EXISTS idx_statuses_author_did ON statuses(author_did);
CREATE INDEX IF NOT EXISTS idx_statuses_created_at ON statuses(created_at);
CREATE INDEX IF NOT EXISTS idx_statuses_expires_at ON statuses(expires_at);

-- Create chat declarations table
CREATE TABLE IF NOT EXISTS chat_declarations (
  uri VARCHAR(512) PRIMARY KEY,
  cid VARCHAR(255) NOT NULL,
  author_did VARCHAR(255) NOT NULL,
  allow_incoming VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add indexes for chat declarations
CREATE INDEX IF NOT EXISTS idx_chat_declarations_author_did ON chat_declarations(author_did);
CREATE INDEX IF NOT EXISTS idx_chat_declarations_created_at ON chat_declarations(created_at);

-- Create notification declarations table
CREATE TABLE IF NOT EXISTS notification_declarations (
  uri VARCHAR(512) PRIMARY KEY,
  cid VARCHAR(255) NOT NULL,
  author_did VARCHAR(255) NOT NULL,
  allow_subscriptions VARCHAR(50) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add indexes for notification declarations
CREATE INDEX IF NOT EXISTS idx_notification_declarations_author_did ON notification_declarations(author_did);
CREATE INDEX IF NOT EXISTS idx_notification_declarations_created_at ON notification_declarations(created_at);

-- Update posts table to add missing fields
ALTER TABLE posts ADD COLUMN IF NOT EXISTS has_thread_gate BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS has_post_gate BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb NOT NULL;

-- Add indexes for new post fields
CREATE INDEX IF NOT EXISTS idx_posts_has_thread_gate ON posts(has_thread_gate);
CREATE INDEX IF NOT EXISTS idx_posts_has_post_gate ON posts(has_post_gate);
CREATE INDEX IF NOT EXISTS idx_posts_tags ON posts USING GIN(tags);

-- Create threadgates table
CREATE TABLE IF NOT EXISTS threadgates (
  uri VARCHAR(512) PRIMARY KEY,
  cid VARCHAR(255) NOT NULL,
  post_uri VARCHAR(512) NOT NULL,
  allow JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add indexes for threadgates
CREATE INDEX IF NOT EXISTS idx_threadgates_post_uri ON threadgates(post_uri);
CREATE INDEX IF NOT EXISTS idx_threadgates_created_at ON threadgates(created_at);

-- Create postgates table
CREATE TABLE IF NOT EXISTS postgates (
  uri VARCHAR(512) PRIMARY KEY,
  cid VARCHAR(255) NOT NULL,
  post_uri VARCHAR(512) NOT NULL,
  embedding_rules JSONB,
  created_at TIMESTAMP NOT NULL,
  indexed_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add indexes for postgates
CREATE INDEX IF NOT EXISTS idx_postgates_post_uri ON postgates(post_uri);
CREATE INDEX IF NOT EXISTS idx_postgates_created_at ON postgates(created_at);

-- Create known followers table
CREATE TABLE IF NOT EXISTS known_followers (
  subject_did VARCHAR(255) NOT NULL,
  follower_did VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  PRIMARY KEY (subject_did, follower_did)
);

-- Add indexes for known followers
CREATE INDEX IF NOT EXISTS idx_known_followers_subject ON known_followers(subject_did);
CREATE INDEX IF NOT EXISTS idx_known_followers_follower ON known_followers(follower_did);

-- Create bidirectional blocks table
CREATE TABLE IF NOT EXISTS bidirectional_blocks (
  did_a VARCHAR(255) NOT NULL,
  did_b VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  PRIMARY KEY (did_a, did_b)
);

-- Add indexes for bidirectional blocks
CREATE INDEX IF NOT EXISTS idx_bidirectional_blocks_did_a ON bidirectional_blocks(did_a);
CREATE INDEX IF NOT EXISTS idx_bidirectional_blocks_did_b ON bidirectional_blocks(did_b);

-- Create post blocks table
CREATE TABLE IF NOT EXISTS post_blocks (
  post_uri VARCHAR(512) NOT NULL,
  viewer_did VARCHAR(255) NOT NULL,
  parent BOOLEAN DEFAULT FALSE NOT NULL,
  root BOOLEAN DEFAULT FALSE NOT NULL,
  embed BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  PRIMARY KEY (post_uri, viewer_did)
);

-- Add indexes for post blocks
CREATE INDEX IF NOT EXISTS idx_post_blocks_post_uri ON post_blocks(post_uri);
CREATE INDEX IF NOT EXISTS idx_post_blocks_viewer_did ON post_blocks(viewer_did);