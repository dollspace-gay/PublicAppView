#!/usr/bin/env node

/**
 * Database debugging script to check user settings and follows
 * Run with: node debug-database.js <user-did>
 */

const { createClient } = require('@atproto/api');

async function debugDatabase(userDid) {
  console.log(`🔍 Debugging database for user: ${userDid}`);
  
  try {
    // 1. Check user settings
    console.log('\n1. Checking user settings...');
    const response = await fetch(`https://appview.dollspace.gay/api/user-settings/${userDid}`);
    
    if (response.ok) {
      const settings = await response.json();
      console.log(`   User settings found:`);
      console.log(`   - dataCollectionForbidden: ${settings.dataCollectionForbidden}`);
      console.log(`   - blockedKeywords: ${settings.blockedKeywords?.length || 0} items`);
      console.log(`   - mutedUsers: ${settings.mutedUsers?.length || 0} items`);
      console.log(`   - lastBackfillAt: ${settings.lastBackfillAt || 'null'}`);
      
      if (settings.dataCollectionForbidden) {
        console.log('   🚨 ISSUE: dataCollectionForbidden is true - this blocks follow processing!');
      }
    } else {
      console.log(`   ❌ Error getting user settings: ${response.status} ${response.statusText}`);
    }
    
    // 2. Check follows in database
    console.log('\n2. Checking follows in database...');
    const followsResponse = await fetch(`https://appview.dollspace.gay/api/follows/${userDid}`);
    
    if (followsResponse.ok) {
      const follows = await followsResponse.json();
      console.log(`   Follows count: ${follows.length}`);
      
      if (follows.length > 0) {
        console.log(`   First few follows:`);
        follows.slice(0, 3).forEach((follow, i) => {
          console.log(`     ${i + 1}. ${follow.followingDid} (created: ${follow.createdAt})`);
        });
      }
    } else {
      console.log(`   ❌ Error getting follows: ${followsResponse.status} ${followsResponse.statusText}`);
    }
    
    // 3. Check user existence
    console.log('\n3. Checking user existence...');
    const userResponse = await fetch(`https://appview.dollspace.gay/api/users/${userDid}`);
    
    if (userResponse.ok) {
      const user = await userResponse.json();
      console.log(`   User exists: ${user.handle || 'no handle'}`);
      console.log(`   Display name: ${user.displayName || 'none'}`);
      console.log(`   Created: ${user.createdAt}`);
    } else {
      console.log(`   ❌ User not found: ${userResponse.status} ${userResponse.statusText}`);
    }
    
  } catch (error) {
    console.error('❌ Error during database debugging:', error.message);
  }
}

// Get DID from command line arguments
const userDid = process.argv[2];
if (!userDid) {
  console.log('Usage: node debug-database.js <user-did>');
  console.log('Example: node debug-database.js did:plc:example123');
  process.exit(1);
}

debugDatabase(userDid);