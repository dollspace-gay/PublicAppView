#!/usr/bin/env node

/**
 * Test script for the new Bluesky-compatible preferences implementation
 * This tests both putPreferences and getPreferences endpoints
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function testPreferences() {
  console.log('🧪 Testing Bluesky-compatible preferences implementation...\n');

  try {
    // Test 1: Get preferences (should return empty array initially)
    console.log('1️⃣ Testing getPreferences (should return empty array)...');
    const getResponse = await fetch(`${BASE_URL}/xrpc/app.bsky.actor.getPreferences`, {
      headers: {
        'Authorization': 'Bearer test-token', // Replace with real token
        'Content-Type': 'application/json'
      }
    });
    
    if (getResponse.ok) {
      const getData = await getResponse.json();
      console.log('✅ getPreferences response:', JSON.stringify(getData, null, 2));
    } else {
      console.log('❌ getPreferences failed:', getResponse.status, await getResponse.text());
    }

    // Test 2: Put preferences (test various preference types)
    console.log('\n2️⃣ Testing putPreferences with various preference types...');
    const testPreferences = [
      {
        $type: 'app.bsky.actor.defs#adultContentPref',
        enabled: false
      },
      {
        $type: 'app.bsky.actor.defs#contentLabelPref',
        label: 'nsfw',
        visibility: 'hide'
      },
      {
        $type: 'app.bsky.actor.defs#feedViewPref',
        hideReplies: false,
        hideRepliesByUnfollowed: true
      }
    ];

    const putResponse = await fetch(`${BASE_URL}/xrpc/app.bsky.actor.putPreferences`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token', // Replace with real token
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preferences: testPreferences
      })
    });

    if (putResponse.ok) {
      console.log('✅ putPreferences successful (status:', putResponse.status, ')');
    } else {
      console.log('❌ putPreferences failed:', putResponse.status, await putResponse.text());
    }

    // Test 3: Get preferences again (should return the preferences we just set)
    console.log('\n3️⃣ Testing getPreferences after setting preferences...');
    const getResponse2 = await fetch(`${BASE_URL}/xrpc/app.bsky.actor.getPreferences`, {
      headers: {
        'Authorization': 'Bearer test-token', // Replace with real token
        'Content-Type': 'application/json'
      }
    });
    
    if (getResponse2.ok) {
      const getData2 = await getResponse2.json();
      console.log('✅ getPreferences response after put:', JSON.stringify(getData2, null, 2));
    } else {
      console.log('❌ getPreferences failed:', getResponse2.status, await getResponse2.text());
    }

    // Test 4: Test invalid preference (should fail)
    console.log('\n4️⃣ Testing putPreferences with invalid preference (should fail)...');
    const invalidResponse = await fetch(`${BASE_URL}/xrpc/app.bsky.actor.putPreferences`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token', // Replace with real token
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preferences: [
          {
            $type: 'com.atproto.server.defs#unknown', // Wrong namespace
            test: 'value'
          }
        ]
      })
    });

    if (!invalidResponse.ok) {
      console.log('✅ Invalid preference correctly rejected:', invalidResponse.status, await invalidResponse.text());
    } else {
      console.log('❌ Invalid preference was accepted (this should not happen)');
    }

    // Test 5: Test missing $type (should fail)
    console.log('\n5️⃣ Testing putPreferences with missing $type (should fail)...');
    const missingTypeResponse = await fetch(`${BASE_URL}/xrpc/app.bsky.actor.putPreferences`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token', // Replace with real token
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preferences: [
          {
            // Missing $type
            test: 'value'
          }
        ]
      })
    });

    if (!missingTypeResponse.ok) {
      console.log('✅ Missing $type correctly rejected:', missingTypeResponse.status, await missingTypeResponse.text());
    } else {
      console.log('❌ Missing $type was accepted (this should not happen)');
    }

    console.log('\n🎉 Preferences implementation test completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
testPreferences();