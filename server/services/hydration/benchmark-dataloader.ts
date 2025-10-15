import { enhancedHydrator } from './index';
import { optimizedHydrator } from './optimized-hydrator';
import { dataLoaderHydrator } from './dataloader-hydrator';
import { createDataLoader } from './dataloader';
import { db } from '../../db';
import { posts } from '../../../shared/schema';
import { desc, sql } from 'drizzle-orm';

interface BenchmarkResult {
  name: string;
  duration: number;
  cacheHits?: number;
  cacheMisses?: number;
  dataLoaderBatches?: number;
}

async function benchmark(
  name: string,
  fn: () => Promise<any>
): Promise<BenchmarkResult> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;

  return {
    name,
    duration,
    cacheHits: result?.stats?.cacheHits,
    cacheMisses: result?.stats?.cacheMisses,
    dataLoaderBatches: result?.stats?.dataLoaderBatches,
  };
}

async function runBenchmarks() {
  console.log('🚀 Running DataLoader Hydrator Benchmarks...\n');

  // Get sample post URIs - mix of popular and recent posts
  const samplePosts = await db
    .select({ uri: posts.uri })
    .from(posts)
    .orderBy(desc(posts.createdAt))
    .limit(100);

  const postUris = samplePosts.map((p) => p.uri);
  const viewerDid = 'did:plc:example123'; // Example viewer DID

  console.log(`Testing with ${postUris.length} posts...\n`);

  // Benchmark 1: Enhanced Hydrator (baseline)
  const enhancedResult = await benchmark('Enhanced Hydrator (baseline)', () =>
    enhancedHydrator.hydratePosts(postUris, viewerDid)
  );

  // Clear any caches
  await optimizedHydrator.clearCache();

  // Benchmark 2: Optimized Hydrator
  const optimizedResult = await benchmark('Optimized Hydrator', () =>
    optimizedHydrator.hydratePosts(postUris, viewerDid)
  );

  // Benchmark 3: DataLoader Hydrator (cold)
  const dataLoader1 = createDataLoader();
  const dataLoaderColdResult = await benchmark(
    'DataLoader Hydrator (cold)',
    () => dataLoaderHydrator.hydratePosts(postUris, viewerDid, dataLoader1)
  );

  // Benchmark 4: DataLoader Hydrator (warm - same posts)
  const dataLoaderWarmResult = await benchmark(
    'DataLoader Hydrator (warm cache)',
    () => dataLoaderHydrator.hydratePosts(postUris, viewerDid, dataLoader1)
  );

  // Benchmark 5: DataLoader with overlapping requests (simulates real usage)
  const dataLoader2 = createDataLoader();
  const halfUris = postUris.slice(0, 50);
  const otherHalfUris = postUris.slice(25, 75); // Overlapping set

  await dataLoaderHydrator.hydratePosts(halfUris, viewerDid, dataLoader2);
  const dataLoaderOverlapResult = await benchmark(
    'DataLoader Hydrator (50% overlap)',
    () => dataLoaderHydrator.hydratePosts(otherHalfUris, viewerDid, dataLoader2)
  );

  // Results table
  const results = [
    enhancedResult,
    optimizedResult,
    dataLoaderColdResult,
    dataLoaderWarmResult,
    dataLoaderOverlapResult,
  ];

  console.log('\n📊 Benchmark Results:');
  console.log('━'.repeat(80));
  console.log(
    'Method'.padEnd(40) +
      'Duration'.padEnd(12) +
      'Batches'.padEnd(10) +
      'Cache Stats'
  );
  console.log('━'.repeat(80));

  results.forEach((result) => {
    const cacheStats =
      result.cacheHits !== undefined
        ? `${result.cacheHits}/${result.cacheMisses} (hits/misses)`
        : 'N/A';
    const batches =
      result.dataLoaderBatches !== undefined
        ? result.dataLoaderBatches.toString()
        : 'N/A';

    console.log(
      result.name.padEnd(40) +
        `${result.duration.toFixed(2)}ms`.padEnd(12) +
        batches.padEnd(10) +
        cacheStats
    );
  });

  console.log('━'.repeat(80));

  // Calculate improvements
  const dataLoaderImprovement = (
    ((enhancedResult.duration - dataLoaderColdResult.duration) /
      enhancedResult.duration) *
    100
  ).toFixed(1);
  const warmCacheImprovement = (
    ((dataLoaderColdResult.duration - dataLoaderWarmResult.duration) /
      dataLoaderColdResult.duration) *
    100
  ).toFixed(1);
  const overlapBenefit = (
    ((dataLoaderColdResult.duration - dataLoaderOverlapResult.duration) /
      dataLoaderColdResult.duration) *
    100
  ).toFixed(1);

  console.log('\n📈 Performance Improvements:');
  console.log(`  • DataLoader vs Enhanced: ${dataLoaderImprovement}% faster`);
  console.log(`  • Warm cache benefit: ${warmCacheImprovement}% faster`);
  console.log(`  • Overlap caching benefit: ${overlapBenefit}% faster`);
  console.log(
    `  • DataLoader batches: ${dataLoaderColdResult.dataLoaderBatches} parallel queries (vs potentially ${postUris.length * 5}+ sequential)`
  );

  // Test complex scenarios
  console.log('\n🔍 Testing Complex Scenarios...\n');

  // Scenario 1: Thread with replies
  const threadPost = await db
    .select({ uri: posts.uri })
    .from(posts)
    .where(sql`${posts.replyCount} > 10`)
    .limit(1);

  if (threadPost.length > 0) {
    const threadPosts = await db
      .select({ uri: posts.uri })
      .from(posts)
      .where(sql`${posts.rootUri} = ${threadPost[0].uri}`)
      .limit(20);

    const threadUris = threadPosts.map((p) => p.uri);
    const dataLoader3 = createDataLoader();

    const threadResult = await benchmark('DataLoader Thread Hydration', () =>
      dataLoaderHydrator.hydratePosts(threadUris, viewerDid, dataLoader3)
    );

    console.log(
      `Thread hydration (${threadUris.length} posts): ${threadResult.duration.toFixed(2)}ms with ${threadResult.dataLoaderBatches} batches`
    );
  }

  // Clean up
  dataLoader1.clearAll();
  dataLoader2.clearAll();

  console.log('\n✅ Benchmarks complete!');
}

// Run benchmarks
runBenchmarks()
  .catch(console.error)
  .finally(() => process.exit(0));
