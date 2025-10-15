import { enhancedHydrator } from './index';
import { optimizedHydrator } from './optimized-hydrator';
import { db } from '../../db';
import { posts } from '../../../shared/schema';
import { sql } from 'drizzle-orm';

interface BenchmarkResult {
  name: string;
  duration: number;
  cacheHits?: number;
  cacheMisses?: number;
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
  };
}

async function runBenchmarks() {
  console.log('🚀 Running Post Hydrator Benchmarks...\n');

  // Get sample post URIs
  const samplePosts = await db
    .select({ uri: posts.uri })
    .from(posts)
    .orderBy(sql`RANDOM()`)
    .limit(50);

  const postUris = samplePosts.map((p) => p.uri);
  const viewerDid = 'did:plc:exampleviewer123'; // Example viewer

  console.log(`Testing with ${postUris.length} posts...\n`);

  // Benchmark 1: Enhanced Hydrator (current)
  const enhancedResult = await benchmark('Enhanced Hydrator', () =>
    enhancedHydrator.hydratePosts(postUris, viewerDid)
  );

  // Clear any caches
  await optimizedHydrator.clearCache();

  // Benchmark 2: Optimized Hydrator (cold cache)
  const optimizedColdResult = await benchmark(
    'Optimized Hydrator (cold cache)',
    () => optimizedHydrator.hydratePosts(postUris, viewerDid)
  );

  // Benchmark 3: Optimized Hydrator (warm cache)
  const optimizedWarmResult = await benchmark(
    'Optimized Hydrator (warm cache)',
    () => optimizedHydrator.hydratePosts(postUris, viewerDid)
  );

  // Benchmark 4: Subset test (to show cache granularity)
  const subsetUris = postUris.slice(0, 10);
  const optimizedSubsetResult = await benchmark(
    'Optimized Hydrator (subset, partially cached)',
    () => optimizedHydrator.hydratePosts(subsetUris, viewerDid)
  );

  // Print results
  console.log('📊 Benchmark Results:\n');
  console.log('─'.repeat(60));
  console.log('Name'.padEnd(40) + 'Duration'.padEnd(12) + 'Cache Stats');
  console.log('─'.repeat(60));

  const results = [
    enhancedResult,
    optimizedColdResult,
    optimizedWarmResult,
    optimizedSubsetResult,
  ];

  results.forEach((result) => {
    const cacheStats =
      result.cacheHits !== undefined
        ? `${result.cacheHits}/${result.cacheMisses} (hits/misses)`
        : 'N/A';

    console.log(
      result.name.padEnd(40) +
        `${result.duration.toFixed(2)}ms`.padEnd(12) +
        cacheStats
    );
  });

  console.log('─'.repeat(60));

  // Calculate improvements
  const coldImprovement = (
    ((enhancedResult.duration - optimizedColdResult.duration) /
      enhancedResult.duration) *
    100
  ).toFixed(1);
  const warmImprovement = (
    ((enhancedResult.duration - optimizedWarmResult.duration) /
      enhancedResult.duration) *
    100
  ).toFixed(1);

  console.log('\n📈 Performance Improvements:');
  console.log(`  • Cold cache: ${coldImprovement}% faster`);
  console.log(`  • Warm cache: ${warmImprovement}% faster`);
  console.log(
    `  • Cache hit rate: ${((optimizedWarmResult.cacheHits! / (optimizedWarmResult.cacheHits! + optimizedWarmResult.cacheMisses!)) * 100).toFixed(1)}%`
  );

  // Test complex scenarios
  console.log('\n🔬 Testing Complex Scenarios...\n');

  // Get posts with embeds and replies
  const complexPosts = await db
    .select({ uri: posts.uri })
    .from(posts)
    .where(sql`${posts.embed} IS NOT NULL OR ${posts.parentUri} IS NOT NULL`)
    .orderBy(sql`RANDOM()`)
    .limit(25);

  const complexUris = complexPosts.map((p) => p.uri);

  await optimizedHydrator.clearCache();

  const enhancedComplexResult = await benchmark(
    'Enhanced Hydrator (complex posts)',
    () => enhancedHydrator.hydratePosts(complexUris, viewerDid)
  );

  const optimizedComplexResult = await benchmark(
    'Optimized Hydrator (complex posts)',
    () => optimizedHydrator.hydratePosts(complexUris, viewerDid)
  );

  const complexImprovement = (
    ((enhancedComplexResult.duration - optimizedComplexResult.duration) /
      enhancedComplexResult.duration) *
    100
  ).toFixed(1);

  console.log('Complex posts benchmark:');
  console.log(`  • Enhanced: ${enhancedComplexResult.duration.toFixed(2)}ms`);
  console.log(`  • Optimized: ${optimizedComplexResult.duration.toFixed(2)}ms`);
  console.log(`  • Improvement: ${complexImprovement}% faster`);

  console.log('\n✅ Benchmark complete!');
}

// Run if executed directly
if (require.main === module) {
  runBenchmarks()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Benchmark failed:', error);
      process.exit(1);
    });
}

export { runBenchmarks };
