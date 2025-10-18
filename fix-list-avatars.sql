-- Clean up empty avatar URLs in lists table
-- This fixes the "Output/list/avatar must be a uri" validation error

UPDATE lists
SET avatar_url = NULL
WHERE avatar_url = '' OR avatar_url = 'undefined' OR avatar_url = 'null';

-- Verify the fix
SELECT COUNT(*) as fixed_count
FROM lists
WHERE avatar_url IS NULL;

SELECT COUNT(*) as remaining_invalid
FROM lists
WHERE avatar_url = '' OR avatar_url = 'undefined' OR avatar_url = 'null';
