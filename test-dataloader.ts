import { createDataLoader } from './server/services/hydration/dataloader';
import { dataLoaderHydrator } from './server/services/hydration/dataloader-hydrator';
import { db } from './server/db';
import { posts } from './shared/schema';
import { desc } from 'drizzle-orm';

async function testDataLoader() {
  console.log('Testing DataLoader implementation...\n');
  
  try {
    // Get some test posts
    const testPosts = await db
      .select({ uri: posts.uri })
      .from(posts)
      .orderBy(desc(posts.createdAt))
      .limit(10);
    
    if (testPosts.length === 0) {
      console.log('No posts found in database');
      return;
    }
    
    const postUris = testPosts.map(p => p.uri);
    console.log(`Found ${postUris.length} posts to hydrate\n`);
    
    // Create a DataLoader instance
    const dataLoader = createDataLoader();
    
    // Test hydration
    console.log('Hydrating posts with DataLoader...');
    const startTime = performance.now();
    
    const result = await dataLoaderHydrator.hydratePosts(
      postUris,
      undefined, // No viewer for this test
      dataLoader
    );
    
    const duration = performance.now() - startTime;
    
    console.log(`\n✅ Hydration complete in ${duration.toFixed(2)}ms`);
    console.log(`\nStats:`);
    console.log(`- Posts hydrated: ${result.posts.size}`);
    console.log(`- Authors loaded: ${result.actors.size}`);
    console.log(`- Aggregations loaded: ${result.aggregations.size}`);
    console.log(`- DataLoader batches: ${result.stats.dataLoaderBatches}`);
    console.log(`- Query time: ${result.stats.queryTime.toFixed(2)}ms`);
    console.log(`- Total time: ${result.stats.totalTime.toFixed(2)}ms`);
    
    // Test cache hit
    console.log('\n\nTesting cache hit (re-hydrating same posts)...');
    const startTime2 = performance.now();
    
    const result2 = await dataLoaderHydrator.hydratePosts(
      postUris,
      undefined,
      dataLoader // Same DataLoader instance
    );
    
    const duration2 = performance.now() - startTime2;
    
    console.log(`✅ Re-hydration complete in ${duration2.toFixed(2)}ms`);
    console.log(`Cache hit improvement: ${((duration - duration2) / duration * 100).toFixed(1)}% faster`);
    
    // Clean up
    dataLoader.clearAll();
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testDataLoader().then(() => process.exit(0));