#!/usr/bin/env tsx
import { db } from '../db';
import { users } from '../../shared/schema';
import { sql, eq } from 'drizzle-orm';
import { identityResolver } from '../services/identity-resolver';

async function backfillHandles() {
  console.log('='.repeat(60));
  console.log('Backfill User Handles from DIDs');
  console.log('='.repeat(60));
  console.log('');

  try {
    const BATCH_SIZE = 100;
    const RATE_LIMIT_MS = 100;
    let totalResolved = 0;
    let totalFailed = 0;

    console.log('[1/3] Counting users with unresolved handles...');
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM users
      WHERE handle LIKE 'did:plc:%'
    `);
    const totalUnresolved = Number(countResult.rows[0].count);
    console.log(`✓ Found ${totalUnresolved} users with unresolved handles`);
    console.log('');

    if (totalUnresolved === 0) {
      console.log('✓ All handles already resolved!');
      process.exit(0);
    }

    console.log('[2/3] Resolving handles in batches...');
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    while (true) {
      // Use LIMIT without OFFSET - always query the first BATCH_SIZE unresolved users
      // This works because we're updating rows as we go, removing them from the result set
      const batch = await db.execute(sql`
        SELECT did, handle
        FROM users
        WHERE handle LIKE 'did:plc:%'
        ORDER BY indexed_at DESC
        LIMIT ${BATCH_SIZE}
      `);

      if (batch.rows.length === 0) {
        break;
      }

      const batchStartResolved = totalResolved;
      const dids = batch.rows.map((row: any) => row.did);
      const resolvedHandles = await identityResolver.resolveDidsToHandles(dids);

      for (const [did, handle] of Array.from(resolvedHandles.entries())) {
        try {
          await db.update(users).set({ handle }).where(eq(users.did, did));
          totalResolved++;
        } catch (error) {
          totalFailed++;
        }
      }

      totalFailed += dids.length - resolvedHandles.size;

      // Check if we made progress in this batch
      const batchResolved = totalResolved - batchStartResolved;
      if (batchResolved === 0) {
        consecutiveFailures++;
        console.log(
          `  ⚠ No progress in batch (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`
        );

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.log('\n✗ Too many consecutive failures. Stopping backfill.');
          console.log(
            '  This may indicate a PLC directory outage or network issues.'
          );
          console.log('  Run this script again later to retry.');
          break;
        }

        // Exponential backoff on repeated failures
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_LIMIT_MS * Math.pow(2, consecutiveFailures))
        );
      } else {
        consecutiveFailures = 0;
      }

      console.log(
        `  Progress: ${totalResolved + totalFailed}/${totalUnresolved} (${totalResolved} resolved, ${totalFailed} failed)`
      );

      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));

      if (totalResolved + totalFailed >= 1000) {
        console.log(
          '\n⚠ Processed 1,000 users. Stopping to avoid rate limits.'
        );
        console.log(
          '  Run this script again to continue resolving more handles.'
        );
        break;
      }
    }

    console.log('');
    console.log('[3/3] Updating search vectors...');
    await db.execute(sql`
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
    console.log(`  - Resolved: ${totalResolved} users`);
    console.log(`  - Failed: ${totalFailed} users`);
    console.log(
      `  - Remaining: ${totalUnresolved - totalResolved - totalFailed} users`
    );
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('✗ Error backfilling handles:', error);
    process.exit(1);
  }
}

backfillHandles();
