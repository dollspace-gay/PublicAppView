#!/usr/bin/env node

/**
 * Debug script to investigate follow synchronization issues
 * Run with: node debug-follows.js <user-handle>
 */

const { createClient } = require('@atproto/api');

async function debugFollows(handle) {
  console.log(`🔍 Debugging follows for user: ${handle}`);
  
  try {
    // 1. Check PDS directly for follows
    console.log('\n1. Checking PDS for follows...');
    const pdsClient = createClient({
      service: 'https://oyster.us-east.host.bsky.network'
    });
    
    // Get user's DID from handle
    const profile = await pdsClient.api.app.bsky.actor.getProfile({ actor: handle });
    const userDid = profile.data.did;
    console.log(`   User DID: ${userDid}`);
    
    // Get follows from PDS
    const follows = await pdsClient.api.app.bsky.graph.getFollows({ 
      actor: userDid,
      limit: 100 
    });
    console.log(`   PDS follows count: ${follows.data.follows.length}`);
    
    if (follows.data.follows.length > 0) {
      console.log(`   First few follows:`);
      follows.data.follows.slice(0, 3).forEach((follow, i) => {
        console.log(`     ${i + 1}. ${follow.handle} (${follow.did})`);
      });
    }
    
    // 2. Check appview for follows
    console.log('\n2. Checking appview for follows...');
    const appviewClient = createClient({
      service: 'https://appview.dollspace.gay'
    });
    
    try {
      const appviewFollows = await appviewClient.api.app.bsky.graph.getFollows({ 
        actor: userDid,
        limit: 100 
      });
      console.log(`   Appview follows count: ${appviewFollows.data.follows.length}`);
      
      if (appviewFollows.data.follows.length > 0) {
        console.log(`   First few follows:`);
        appviewFollows.data.follows.slice(0, 3).forEach((follow, i) => {
          console.log(`     ${i + 1}. ${follow.handle} (${follow.did})`);
        });
      }
    } catch (error) {
      console.log(`   ❌ Error getting follows from appview: ${error.message}`);
    }
    
    // 3. Check if user exists in appview
    console.log('\n3. Checking if user exists in appview...');
    try {
      const profile = await appviewClient.api.app.bsky.actor.getProfile({ actor: userDid });
      console.log(`   ✅ User exists in appview: ${profile.data.displayName || profile.data.handle}`);
    } catch (error) {
      console.log(`   ❌ User not found in appview: ${error.message}`);
    }
    
    // 4. Check timeline directly
    console.log('\n4. Checking timeline...');
    try {
      const timeline = await appviewClient.api.app.bsky.feed.getTimeline({ limit: 5 });
      console.log(`   Timeline posts count: ${timeline.data.feed.length}`);
      
      if (timeline.data.feed.length > 0) {
        console.log(`   First few timeline posts:`);
        timeline.data.feed.slice(0, 3).forEach((item, i) => {
          const post = item.post;
          console.log(`     ${i + 1}. ${post.author.displayName || post.author.handle}: ${post.record.text?.substring(0, 50)}...`);
        });
      }
    } catch (error) {
      console.log(`   ❌ Error getting timeline: ${error.message}`);
    }
    
    // 5. Summary
    console.log('\n📊 Summary:');
    console.log(`   PDS follows: ${follows.data.follows.length}`);
    console.log(`   Appview follows: ${appviewFollows?.data?.follows?.length || 'ERROR'}`);
    
    if (follows.data.follows.length > 0 && (!appviewFollows?.data?.follows || appviewFollows.data.follows.length === 0)) {
      console.log('\n🚨 ISSUE IDENTIFIED: Follows exist in PDS but not in appview');
      console.log('   This indicates a synchronization problem between PDS and appview.');
      console.log('   Possible causes:');
      console.log('   - User has dataCollectionForbidden: true');
      console.log('   - Firehose connection issues');
      console.log('   - Follow events not being processed');
      console.log('   - User not properly indexed in appview');
    } else if (follows.data.follows.length === 0) {
      console.log('\n✅ No follows found in PDS - this is expected behavior');
    } else {
      console.log('\n✅ Follows are synchronized correctly');
    }
    
  } catch (error) {
    console.error('❌ Error during debugging:', error.message);
  }
}

// Get handle from command line arguments
const handle = process.argv[2];
if (!handle) {
  console.log('Usage: node debug-follows.js <user-handle>');
  console.log('Example: node debug-follows.js alice.bsky.social');
  process.exit(1);
}

debugFollows(handle);