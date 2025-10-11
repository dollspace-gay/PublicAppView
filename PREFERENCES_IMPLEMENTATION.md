# Bluesky-Compatible Preferences Implementation

This document describes the complete implementation of AT Protocol actor preferences following Bluesky's exact patterns.

## Overview

The preferences system allows users to store and retrieve their personal settings in a format compatible with Bluesky's AppView implementation. It supports the full range of preference types defined in the AT Protocol lexicon.

## Database Schema

### `account_pref` Table

```sql
CREATE TABLE account_pref (
  id SERIAL PRIMARY KEY,
  user_did VARCHAR(255) NOT NULL REFERENCES users(did) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL, -- preference type (e.g., "app.bsky.actor.defs#adultContentPref")
  value_json JSONB NOT NULL, -- preference data as JSON
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
```

**Indexes:**
- `idx_account_pref_user_did` - Fast user lookups
- `idx_account_pref_name` - Fast preference type lookups  
- `idx_account_pref_user_did_name` - Fast user + type lookups

## API Endpoints

### `app.bsky.actor.getPreferences`

**Method:** GET  
**Authentication:** Required  
**Description:** Retrieves all user preferences

**Response:**
```json
{
  "preferences": [
    {
      "$type": "app.bsky.actor.defs#adultContentPref",
      "enabled": false
    },
    {
      "$type": "app.bsky.actor.defs#contentLabelPref", 
      "label": "nsfw",
      "visibility": "hide"
    }
  ]
}
```

### `app.bsky.actor.putPreferences`

**Method:** POST  
**Authentication:** Required  
**Description:** Replaces all user preferences (atomic operation)

**Request Body:**
```json
{
  "preferences": [
    {
      "$type": "app.bsky.actor.defs#adultContentPref",
      "enabled": false
    }
  ]
}
```

**Response:** `200 OK` (no body)

## Supported Preference Types

### Core Preferences
- `app.bsky.actor.defs#adultContentPref` - Adult content filtering
- `app.bsky.actor.defs#contentLabelPref` - Content label visibility
- `app.bsky.actor.defs#savedFeedsPref` - Saved feed preferences
- `app.bsky.actor.defs#savedFeedsPrefV2` - Saved feed preferences v2
- `app.bsky.actor.defs#feedViewPref` - Feed view preferences
- `app.bsky.actor.defs#threadViewPref` - Thread view preferences
- `app.bsky.actor.defs#interestsPref` - User interests
- `app.bsky.actor.defs#mutedWordsPref` - Muted words
- `app.bsky.actor.defs#hiddenPostsPref` - Hidden posts
- `app.bsky.actor.defs#bskyAppStatePref` - App state preferences
- `app.bsky.actor.defs#labelersPref` - Labeler preferences
- `app.bsky.actor.defs#postInteractionSettingsPref` - Post interaction settings
- `app.bsky.actor.defs#verificationPrefs` - Verification preferences

### Restricted Preferences (Full Access Required)
- `app.bsky.actor.defs#personalDetailsPref` - Personal details

## Security Features

### Namespace Filtering
- Only `app.bsky.*` namespace preferences are allowed
- Preferences from other namespaces are rejected with `400 Bad Request`

### Permission System
- Some preferences require full access (e.g., personal details)
- App passwords have limited access to certain preference types
- Permission checks are performed on both read and write operations

### Type Validation
- All preferences must have a valid `$type` field
- Invalid or missing `$type` fields are rejected with `400 Bad Request`

## Implementation Details

### Storage Layer
- **Atomic Operations**: Uses database transactions for atomic preference replacement
- **Namespace Isolation**: Only `app.bsky.*` preferences are stored/retrieved
- **JSON Storage**: Preferences stored as JSONB for flexibility and performance

### Caching
- **In-Memory Cache**: Preferences are cached with TTL for performance
- **Cache Invalidation**: Cache is invalidated on preference updates
- **Cache Key**: Based on user DID

### Error Handling
- **Validation Errors**: Proper HTTP status codes and error messages
- **Database Errors**: Graceful error handling with logging
- **Permission Errors**: Clear error messages for authorization failures

## Migration

To add the preferences system to an existing database:

1. Run the migration:
   ```bash
   psql -d your_database -f migrations/add_account_pref_table.sql
   ```

2. Restart the server to load the new schema

## Testing

Use the provided test script to verify the implementation:

```bash
node test-preferences-implementation.js
```

The test script covers:
- ✅ Getting empty preferences
- ✅ Setting valid preferences
- ✅ Retrieving set preferences
- ✅ Rejecting invalid namespaces
- ✅ Rejecting missing $type fields

## Compatibility

This implementation is fully compatible with:
- ✅ Bluesky's official AppView
- ✅ AT Protocol lexicon specifications
- ✅ Standard AT Protocol clients
- ✅ Bluesky web and mobile apps

## Performance

- **Database Queries**: Optimized with proper indexes
- **Caching**: Reduces database load for frequent reads
- **Transactions**: Ensures data consistency
- **JSON Storage**: Efficient storage and retrieval

## Future Enhancements

1. **OAuth Scope Integration**: Proper full access vs limited access based on OAuth scopes
2. **Preference Validation**: Validate preference data against lexicon schemas
3. **Audit Logging**: Log preference changes for moderation
4. **Bulk Operations**: Support for bulk preference updates
5. **Preference Templates**: Default preference sets for new users