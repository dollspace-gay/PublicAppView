-- Add account_pref table for Bluesky-style preferences storage
-- This follows the same pattern as Bluesky's PDS implementation

CREATE TABLE IF NOT EXISTS account_pref (
  id SERIAL PRIMARY KEY,
  user_did VARCHAR(255) NOT NULL REFERENCES users(did) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL, -- preference type (e.g., "app.bsky.actor.defs#adultContentPref")
  value_json JSONB NOT NULL, -- preference data as JSON
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_account_pref_user_did ON account_pref(user_did);
CREATE INDEX IF NOT EXISTS idx_account_pref_name ON account_pref(name);
CREATE INDEX IF NOT EXISTS idx_account_pref_user_did_name ON account_pref(user_did, name);

-- Add comment explaining the table purpose
COMMENT ON TABLE account_pref IS 'Stores user preferences in Bluesky-compatible format with JSON storage';
COMMENT ON COLUMN account_pref.name IS 'Preference type identifier (e.g., app.bsky.actor.defs#adultContentPref)';
COMMENT ON COLUMN account_pref.value_json IS 'Preference data stored as JSON object';