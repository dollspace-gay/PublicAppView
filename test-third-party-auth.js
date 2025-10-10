#!/usr/bin/env node

/**
 * Test script to verify third-party client authentication works
 * This simulates how a third-party client would authenticate with the appview
 */

const { BskyAgent } = require('@atproto/api');

const APPVIEW_URL = process.env.APPVIEW_URL || 'http://localhost:5000';
const TEST_HANDLE = process.env.TEST_HANDLE || 'test.bsky.social';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'test-password';

async function testThirdPartyAuth() {
  console.log('🧪 Testing Third-Party Client Authentication');
  console.log('==========================================');
  console.log(`AppView URL: ${APPVIEW_URL}`);
  console.log(`Test Handle: ${TEST_HANDLE}`);
  console.log('');

  try {
    // Create a BskyAgent pointing to the appview
    const agent = new BskyAgent({ service: APPVIEW_URL });
    
    console.log('1. Attempting to login with third-party client...');
    
    // This should work with the fixed XRPC proxy middleware
    const result = await agent.login({
      identifier: TEST_HANDLE,
      password: TEST_PASSWORD,
    });
    
    console.log('✅ Login successful!');
    console.log(`   DID: ${result.data.did}`);
    console.log(`   Handle: ${result.data.handle}`);
    console.log('');

    console.log('2. Testing authenticated API call...');
    
    // Test a simple authenticated endpoint
    const profile = await agent.api.app.bsky.actor.getProfile({
      actor: result.data.did
    });
    
    console.log('✅ Profile fetch successful!');
    console.log(`   Display Name: ${profile.data.displayName || 'None'}`);
    console.log(`   Followers: ${profile.data.followersCount || 0}`);
    console.log('');

    console.log('3. Testing timeline access...');
    
    // Test timeline access (requires authentication)
    const timeline = await agent.api.app.bsky.feed.getTimeline({
      limit: 5
    });
    
    console.log('✅ Timeline access successful!');
    console.log(`   Posts fetched: ${timeline.data.feed.length}`);
    console.log('');

    console.log('🎉 All tests passed! Third-party authentication is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.cause) {
      console.error('   Cause:', error.cause.message);
    }
    
    if (error.responseBody) {
      console.error('   Response:', JSON.stringify(error.responseBody, null, 2));
    }
    
    console.log('');
    console.log('💡 This test requires:');
    console.log('   1. The appview server to be running');
    console.log('   2. Valid TEST_HANDLE and TEST_PASSWORD environment variables');
    console.log('   3. The fixed XRPC proxy middleware to handle AT Protocol tokens');
    
    process.exit(1);
  }
}

// Run the test
testThirdPartyAuth().catch(console.error);