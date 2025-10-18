#!/usr/bin/env tsx
/**
 * Refresh Unnamed Feeds Script
 *
 * Fetches complete metadata from PDS for all feed generators
 * that have empty or missing displayNames ("Unnamed Feed")
 *
 * Usage:
 *   npm run refresh-unnamed-feeds
 *   or
 *   tsx scripts/refresh-unnamed-feeds.ts
 */

import { feedGeneratorDiscovery } from '../server/services/feed-generator-discovery';

async function main() {
  console.log('='.repeat(60));
  console.log('Refreshing Unnamed Feed Generators');
  console.log('='.repeat(60));
  console.log('');

  try {
    const result = await feedGeneratorDiscovery.refreshUnnamedFeeds();

    console.log('');
    console.log('='.repeat(60));
    console.log('Results:');
    console.log(`  Total unnamed feeds found: ${result.total}`);
    console.log(`  Successfully updated: ${result.updated}`);
    console.log(`  Failed to update: ${result.failed}`);
    console.log('='.repeat(60));

    if (result.total === 0) {
      console.log('\nGreat! All feed generators have proper names.');
    } else if (result.updated > 0) {
      console.log(
        `\nSuccessfully updated ${result.updated} feed generators with their proper names!`
      );
    }

    if (result.failed > 0) {
      console.log(
        `\nWarning: ${result.failed} feed generators could not be updated.`
      );
      console.log(
        'This may be due to PDSes being offline or feeds being deleted.'
      );
    }

    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\nError running refresh:', error);
    process.exit(1);
  }
}

main();
