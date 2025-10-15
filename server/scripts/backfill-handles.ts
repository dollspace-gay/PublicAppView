#!/usr/bin/env tsx
import { pool } from '../db';
import { DidResolver } from '@atproto/identity';

const resolver = new DidResolver({});

async function backfillHandles() {
  console.log('='.repeat(60));
  console.log('Backfill User Handles from DIDs');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Get users where handle equals DID (not resolved yet)
    console.log('[1/3] Finding users with unresolved handles...');
    const result = await pool.query(`
      SELECT did, handle
      FROM users
      WHERE handle LIKE 'did:plc:%'
      ORDER BY indexed_at DESC
      LIMIT 1000;
    `);

    const unresolved = result.rows;
    console.log(`✓ Found ${unresolved.length} users with unresolved handles`);
    console.log('');

    if (unresolved.length === 0) {
      console.log('✓ All handles already resolved!');
      process.exit(0);
    }

    // Resolve handles in batches
    console.log('[2/3] Resolving handles via PLC directory...');
    let resolved = 0;
    let failed = 0;

    for (let i = 0; i < unresolved.length; i++) {
      const user = unresolved[i];

      try {
        // Resolve DID to get handle
        const didDoc = await resolver.resolve(user.did);

        if (didDoc && didDoc.alsoKnownAs && didDoc.alsoKnownAs.length > 0) {
          // Extract handle from at:// URI (e.g., "at://alice.bsky.social" -> "alice.bsky.social")
          const handleUri = didDoc.alsoKnownAs[0];
          const handle = handleUri.replace('at://', '');

          // Update user with resolved handle
          await pool.query(`UPDATE users SET handle = $1 WHERE did = $2`, [
            handle,
            user.did,
          ]);

          resolved++;

          if (resolved % 10 === 0) {
            console.log(
              `  Progress: ${resolved}/${unresolved.length} resolved`
            );
          }
        } else {
          failed++;
        }
      } catch {
        // Skip users that fail resolution (deleted accounts, etc.)
        failed++;
      }

      // Rate limit: 50ms delay between requests
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log(`✓ Resolved ${resolved} handles`);
    if (failed > 0) {
      console.log(`  Skipped ${failed} users (deleted or invalid DIDs)`);
    }
    console.log('');

    // Update search vectors for resolved users
    console.log('[3/3] Updating search vectors...');
    await pool.query(`
      UPDATE users
      SET search_vector = 
        setweight(to_tsvector('simple', COALESCE(handle,'')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(display_name,'')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(description,'')), 'C')
      WHERE handle NOT LIKE 'did:plc:%';
    `);
    console.log('✓ Search vectors updated');
    console.log('');

    console.log('='.repeat(60));
    console.log('✓ Handle backfill completed!');
    console.log(`  - Resolved: ${resolved} users`);
    console.log(`  - Failed: ${failed} users`);
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('✗ Error backfilling handles:', error);
    process.exit(1);
  }
}

backfillHandles();
