/**
 * Test script to demonstrate DID resolver caching and rate limiting
 * 
 * Usage: npx tsx test-did-resolver-cache.ts
 */

import { didResolver } from './server/services/did-resolver';

async function testCaching() {
  console.log('=== DID Resolver Cache Test ===\n');
  
  // Test DIDs (real Bluesky DIDs)
  const testDIDs = [
    'did:plc:z72i7hdynmk6r22z27h6tvur', // bsky.app official
    'did:plc:ewvi7nxzyoun6zhxrhs64oiz', // jay.bsky.team
    'did:plc:ragtjsm2j2vknwkz3zp4oxrd', // pfrazee.com
  ];
  
  console.log('Initial status:');
  console.log(JSON.stringify(didResolver.getCacheStats(), null, 2));
  console.log('\n');
  
  // First pass - cache misses
  console.log('=== First Resolution (Cache Miss) ===');
  const startTime1 = Date.now();
  
  for (const did of testDIDs) {
    const start = Date.now();
    const handle = await didResolver.resolveDIDToHandle(did);
    const duration = Date.now() - start;
    console.log(`✓ ${did} → ${handle} (${duration}ms)`);
  }
  
  const totalTime1 = Date.now() - startTime1;
  console.log(`\nTotal time: ${totalTime1}ms`);
  console.log('\nCache stats after first pass:');
  console.log(JSON.stringify(didResolver.getCacheStats(), null, 2));
  console.log('\n');
  
  // Second pass - cache hits
  console.log('=== Second Resolution (Cache Hit) ===');
  const startTime2 = Date.now();
  
  for (const did of testDIDs) {
    const start = Date.now();
    const handle = await didResolver.resolveDIDToHandle(did);
    const duration = Date.now() - start;
    console.log(`✓ ${did} → ${handle} (${duration}ms)`);
  }
  
  const totalTime2 = Date.now() - startTime2;
  console.log(`\nTotal time: ${totalTime2}ms`);
  console.log(`Speedup: ${(totalTime1 / totalTime2).toFixed(1)}x faster\n`);
  
  console.log('Final cache stats:');
  const finalStats = didResolver.getCacheStats();
  console.log(JSON.stringify(finalStats, null, 2));
  
  console.log('\n=== Full Status ===');
  const status = didResolver.getStatus();
  console.log(JSON.stringify(status, null, 2));
  
  console.log('\n✅ Test complete!');
  console.log(`Cache hit rate: ${finalStats.hitRate}`);
  console.log(`Expected: ~50% (3 hits out of 6 total requests)`);
}

async function testConcurrency() {
  console.log('\n\n=== Concurrency Test ===\n');
  console.log('Simulating 50 concurrent DID resolutions...\n');
  
  // Create 50 requests (mix of unique and duplicate DIDs)
  const testDIDs = [
    'did:plc:z72i7hdynmk6r22z27h6tvur',
    'did:plc:ewvi7nxzyoun6zhxrhs64oiz',
    'did:plc:ragtjsm2j2vknwkz3zp4oxrd',
  ];
  
  // Generate 50 requests (mostly duplicates)
  const requests = Array(50).fill(0).map((_, i) => 
    testDIDs[i % testDIDs.length]
  );
  
  const start = Date.now();
  
  // Fire all requests concurrently
  const promises = requests.map(async (did) => {
    return didResolver.resolveDIDToHandle(did);
  });
  
  const results = await Promise.all(promises);
  const duration = Date.now() - start;
  
  console.log(`✓ Resolved ${results.length} DIDs in ${duration}ms`);
  console.log(`Average: ${(duration / results.length).toFixed(1)}ms per DID\n`);
  
  const status = didResolver.getStatus();
  console.log('Queue stats:');
  console.log(JSON.stringify(status.queue, null, 2));
  console.log('\nCache stats:');
  console.log(JSON.stringify(status.cache, null, 2));
  
  console.log('\n✅ Concurrency test complete!');
  console.log(`Most requests should be served from cache with <1ms response time.`);
}

// Run tests
async function main() {
  try {
    await testCaching();
    await testConcurrency();
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
