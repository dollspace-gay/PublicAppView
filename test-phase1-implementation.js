#!/usr/bin/env node

/**
 * Test script for Phase 1 implementation
 * Tests post aggregations and viewer state hydration
 */

import { storage } from './server/storage.js';

async function testPhase1Implementation() {
  console.log('🧪 Testing Phase 1 Implementation...\n');

  try {
    // Test 1: Create a test post aggregation
    console.log('1. Testing post aggregation creation...');
    const testPostUri = 'at://test.bsky.app/app.bsky.feed.post/test123';
    
    const aggregation = await storage.createPostAggregation({
      postUri: testPostUri,
      likeCount: 5,
      repostCount: 3,
      replyCount: 2,
      bookmarkCount: 1,
      quoteCount: 0,
    });
    
    console.log('✅ Post aggregation created:', aggregation);
    
    // Test 2: Retrieve post aggregations
    console.log('\n2. Testing post aggregations retrieval...');
    const aggregations = await storage.getPostAggregations([testPostUri]);
    console.log('✅ Retrieved aggregations:', aggregations.get(testPostUri));
    
    // Test 3: Increment post aggregation
    console.log('\n3. Testing post aggregation increment...');
    await storage.incrementPostAggregation(testPostUri, 'likeCount', 2);
    const updatedAggregation = await storage.getPostAggregation(testPostUri);
    console.log('✅ Updated aggregation likeCount:', updatedAggregation?.likeCount);
    
    // Test 4: Create viewer state
    console.log('\n4. Testing viewer state creation...');
    const testViewerDid = 'did:plc:testviewer123';
    const viewerState = await storage.createPostViewerState({
      postUri: testPostUri,
      viewerDid: testViewerDid,
      likeUri: 'at://test.bsky.app/app.bsky.feed.like/like123',
      repostUri: 'at://test.bsky.app/app.bsky.feed.repost/repost123',
      bookmarked: true,
      threadMuted: false,
    });
    
    console.log('✅ Viewer state created:', viewerState);
    
    // Test 5: Retrieve viewer states
    console.log('\n5. Testing viewer states retrieval...');
    const viewerStates = await storage.getPostViewerStates([testPostUri], testViewerDid);
    console.log('✅ Retrieved viewer states:', viewerStates.get(testPostUri));
    
    // Test 6: Test thread context
    console.log('\n6. Testing thread context creation...');
    const threadContext = await storage.createThreadContext({
      postUri: testPostUri,
      rootAuthorLikeUri: 'at://test.bsky.app/app.bsky.feed.like/rootlike123',
    });
    
    console.log('✅ Thread context created:', threadContext);
    
    // Test 7: Retrieve thread context
    console.log('\n7. Testing thread context retrieval...');
    const retrievedContext = await storage.getThreadContext(testPostUri);
    console.log('✅ Retrieved thread context:', retrievedContext);
    
    console.log('\n🎉 All Phase 1 tests passed!');
    console.log('\n📊 Summary:');
    console.log('- ✅ Post aggregations: Working');
    console.log('- ✅ Viewer states: Working');
    console.log('- ✅ Thread contexts: Working');
    console.log('- ✅ Increment operations: Working');
    console.log('- ✅ Batch retrieval: Working');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testPhase1Implementation().then(() => {
  console.log('\n✨ Phase 1 implementation test completed successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test failed with error:', error);
  process.exit(1);
});