#!/usr/bin/env node

/**
 * Data Consistency Test Script
 * 
 * This script tests data consistency across all major XRPC endpoints
 * to ensure that the recent schema and caching improvements are working correctly.
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_USER_DID = process.env.TEST_USER_DID || 'did:plc:test123';
const TEST_AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || '';

// Test configuration
const TESTS = [
  {
    name: 'Health Check',
    endpoint: '/xrpc/com.atproto.server.describeServer',
    method: 'GET',
    auth: false,
  },
  {
    name: 'Get Profile',
    endpoint: `/xrpc/app.bsky.actor.getProfile?actor=${TEST_USER_DID}`,
    method: 'GET',
    auth: false,
  },
  {
    name: 'Get Author Feed',
    endpoint: `/xrpc/app.bsky.feed.getAuthorFeed?actor=${TEST_USER_DID}&limit=10`,
    method: 'GET',
    auth: false,
  },
  {
    name: 'Get Timeline',
    endpoint: '/xrpc/app.bsky.feed.getTimeline?limit=10',
    method: 'GET',
    auth: true,
  },
  {
    name: 'Get Notifications',
    endpoint: '/xrpc/app.bsky.notification.listNotifications?limit=10',
    method: 'GET',
    auth: true,
  },
];

// Test results
const results = {
  passed: 0,
  failed: 0,
  errors: [],
  details: []
};

/**
 * Make HTTP request
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;
    
    const requestOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DataConsistencyTest/1.0',
        ...options.headers
      },
      timeout: 10000
    };

    if (options.auth && TEST_AUTH_TOKEN) {
      requestOptions.headers.Authorization = `Bearer ${TEST_AUTH_TOKEN}`;
    }

    const req = client.request(url, requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: jsonData
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Test data consistency for post aggregations
 */
function testPostAggregations(posts) {
  const issues = [];
  
  for (const post of posts) {
    if (typeof post.replyCount !== 'number' || post.replyCount < 0) {
      issues.push(`Post ${post.uri}: Invalid replyCount (${post.replyCount})`);
    }
    if (typeof post.repostCount !== 'number' || post.repostCount < 0) {
      issues.push(`Post ${post.uri}: Invalid repostCount (${post.repostCount})`);
    }
    if (typeof post.likeCount !== 'number' || post.likeCount < 0) {
      issues.push(`Post ${post.uri}: Invalid likeCount (${post.likeCount})`);
    }
    if (typeof post.bookmarkCount !== 'number' || post.bookmarkCount < 0) {
      issues.push(`Post ${post.uri}: Invalid bookmarkCount (${post.bookmarkCount})`);
    }
    if (typeof post.quoteCount !== 'number' || post.quoteCount < 0) {
      issues.push(`Post ${post.uri}: Invalid quoteCount (${post.quoteCount})`);
    }
  }
  
  return issues;
}

/**
 * Test data consistency for viewer states
 */
function testViewerStates(posts) {
  const issues = [];
  
  for (const post of posts) {
    if (post.viewer) {
      if (typeof post.viewer.bookmarked !== 'boolean') {
        issues.push(`Post ${post.uri}: Invalid bookmarked state (${post.viewer.bookmarked})`);
      }
      if (typeof post.viewer.threadMuted !== 'boolean') {
        issues.push(`Post ${post.uri}: Invalid threadMuted state (${post.viewer.threadMuted})`);
      }
      if (typeof post.viewer.replyDisabled !== 'boolean') {
        issues.push(`Post ${post.uri}: Invalid replyDisabled state (${post.viewer.replyDisabled})`);
      }
      if (typeof post.viewer.embeddingDisabled !== 'boolean') {
        issues.push(`Post ${post.uri}: Invalid embeddingDisabled state (${post.viewer.embeddingDisabled})`);
      }
      if (typeof post.viewer.pinned !== 'boolean') {
        issues.push(`Post ${post.uri}: Invalid pinned state (${post.viewer.pinned})`);
      }
    }
  }
  
  return issues;
}

/**
 * Test data consistency for labels
 */
function testLabels(posts) {
  const issues = [];
  
  for (const post of posts) {
    if (!Array.isArray(post.labels)) {
      issues.push(`Post ${post.uri}: Labels should be an array (${typeof post.labels})`);
    } else {
      for (const label of post.labels) {
        if (!label.src || !label.val || !label.uri) {
          issues.push(`Post ${post.uri}: Invalid label structure (${JSON.stringify(label)})`);
        }
      }
    }
  }
  
  return issues;
}

/**
 * Run a single test
 */
async function runTest(test) {
  console.log(`\n🧪 Running test: ${test.name}`);
  console.log(`   Endpoint: ${test.endpoint}`);
  
  try {
    const url = `${BASE_URL}${test.endpoint}`;
    const response = await makeRequest(url, {
      method: test.method,
      auth: test.auth
    });
    
    const testResult = {
      name: test.name,
      endpoint: test.endpoint,
      statusCode: response.statusCode,
      success: response.statusCode >= 200 && response.statusCode < 300,
      data: response.data,
      issues: []
    };
    
    if (testResult.success) {
      console.log(`   ✅ Status: ${response.statusCode}`);
      
      // Test data consistency based on response type
      if (test.name === 'Get Author Feed' || test.name === 'Get Timeline') {
        const posts = response.data.feed?.map(item => item.post) || [];
        testResult.issues.push(...testPostAggregations(posts));
        testResult.issues.push(...testViewerStates(posts));
        testResult.issues.push(...testLabels(posts));
      } else if (test.name === 'Get Profile') {
        const profile = response.data;
        if (profile.labels && !Array.isArray(profile.labels)) {
          testResult.issues.push(`Profile labels should be an array (${typeof profile.labels})`);
        }
      }
      
      if (testResult.issues.length === 0) {
        console.log(`   ✅ Data consistency: PASSED`);
        results.passed++;
      } else {
        console.log(`   ⚠️  Data consistency: ${testResult.issues.length} issues found`);
        testResult.issues.forEach(issue => console.log(`      - ${issue}`));
        results.failed++;
      }
    } else {
      console.log(`   ❌ Status: ${response.statusCode}`);
      console.log(`   Error: ${JSON.stringify(response.data)}`);
      results.failed++;
    }
    
    results.details.push(testResult);
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    results.failed++;
    results.errors.push({
      test: test.name,
      error: error.message
    });
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting Data Consistency Tests');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Test User: ${TEST_USER_DID}`);
  console.log(`   Auth Token: ${TEST_AUTH_TOKEN ? 'Provided' : 'Not provided'}`);
  
  // Run all tests
  for (const test of TESTS) {
    await runTest(test);
  }
  
  // Print summary
  console.log('\n📊 Test Summary');
  console.log(`   Total Tests: ${TESTS.length}`);
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Success Rate: ${((results.passed / TESTS.length) * 100).toFixed(1)}%`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ Errors:');
    results.errors.forEach(error => {
      console.log(`   - ${error.test}: ${error.error}`);
    });
  }
  
  // Print detailed results
  console.log('\n📋 Detailed Results:');
  results.details.forEach(detail => {
    const status = detail.success ? '✅' : '❌';
    console.log(`   ${status} ${detail.name} (${detail.statusCode})`);
    if (detail.issues.length > 0) {
      detail.issues.forEach(issue => {
        console.log(`      - ${issue}`);
      });
    }
  });
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Data Consistency Test Script

Usage: node test-data-consistency.js [options]

Environment Variables:
  API_BASE_URL     - Base URL for the API (default: http://localhost:3000)
  TEST_USER_DID    - DID of test user (default: did:plc:test123)
  TEST_AUTH_TOKEN  - Auth token for authenticated endpoints

Options:
  --help, -h       - Show this help message
  --verbose, -v    - Show verbose output

Examples:
  node test-data-consistency.js
  API_BASE_URL=https://api.example.com TEST_AUTH_TOKEN=abc123 node test-data-consistency.js
`);
  process.exit(0);
}

// Run the tests
runTests().catch(error => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});