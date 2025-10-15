/**
 * Cleanup script to remove corrupted sessions from the database
 *
 * This script is useful after fixing encryption bugs where Promise objects
 * may have been stored instead of encrypted strings.
 *
 * Usage: tsx server/scripts/cleanup-corrupted-sessions.ts
 */

import { storage } from '../storage';

async function cleanupCorruptedSessions() {
  console.log('[CLEANUP] Starting corrupted session cleanup...');

  try {
    const deletedCount = await storage.deleteCorruptedSessions();

    if (deletedCount > 0) {
      console.log(
        `[CLEANUP] ✓ Successfully deleted ${deletedCount} corrupted session(s)`
      );
    } else {
      console.log('[CLEANUP] ✓ No corrupted sessions found');
    }

    process.exit(0);
  } catch (error) {
    console.error('[CLEANUP] Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupCorruptedSessions();
