#!/usr/bin/env tsx
import { AtpAgent } from '@atproto/api';
import { IdResolver } from '@atproto/identity';
import { readCar, MemoryBlockstore } from '@atproto/repo';
import { ReadableRepo } from '@atproto/repo/dist/readable-repo.js';
import { createStorage } from './server/storage';
import { createDbPool } from './server/db';

const DID = 'did:plc:dzvxvsiy3maw4iarpvizsj67'; // dollspace.gay

const importDb = createDbPool(2, "direct-import");
const storage = createStorage(importDb);
const didResolver = new IdResolver();

async function importRepo() {
  console.log(`[DIRECT_IMPORT] Starting import for ${DID}...`);
  
  const didDoc = await didResolver.did.resolve(DID);
  const pdsService = didDoc.service.find((s: any) => 
    s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  
  const pdsUrl = pdsService.serviceEndpoint;
  console.log(`[DIRECT_IMPORT] PDS: ${pdsUrl}`);
  
  const pdsAgent = new AtpAgent({ service: pdsUrl });
  const response = await pdsAgent.com.atproto.sync.getRepo({ did: DID });
  
  const carBytes = response.data as Uint8Array;
  console.log(`[DIRECT_IMPORT] Downloaded ${carBytes.length} bytes`);
  
  const { roots, blocks } = await readCar(carBytes);
  console.log(`[DIRECT_IMPORT] Parsing repo (${blocks.size} blocks, ${roots.length} roots)...`);

  const blockstore = new MemoryBlockstore(blocks);
  const repo = await ReadableRepo.load(blockstore, roots[0]);

  console.log(`[DIRECT_IMPORT] Walking records...`);
  
  const stats = {
    users: 0,
    posts: 0,
    likes: 0,
    reposts: 0,
    follows: 0,
    blocks: 0,
    skipped: 0
  };

  // First pass: create user
  for await (const { collection, rkey, record } of repo.walkRecords()) {
    if (collection === 'app.bsky.actor.profile') {
      try {
        // Resolve handle
        const handle = await didResolver.handle.resolve(DID);
        
        await storage.createUser({
          did: DID,
          handle: handle || DID,
          display_name: record.displayName || null,
          avatar_url: null,
          indexed_at: new Date()
        });
        stats.users++;
        console.log(`[DIRECT_IMPORT] Created user: ${handle || DID}`);
      } catch (error: any) {
        console.error(`[DIRECT_IMPORT] Error creating user:`, error);
      }
    }
  }

  // Second pass: create posts
  for await (const { collection, rkey, record, cid } of repo.walkRecords()) {
    if (collection === 'app.bsky.feed.post') {
      try {
        const uri = `at://${DID}/${collection}/${rkey}`;
        await storage.createPost({
          uri,
          cid: cid?.toString() || 'unknown',
          author_did: DID,
          text: record.text || '',
          reply_parent: record.reply?.parent?.uri || null,
          reply_root: record.reply?.root?.uri || null,
          created_at: new Date(record.createdAt),
          indexed_at: new Date()
        });
        stats.posts++;
        if (stats.posts % 100 === 0) {
          console.log(`[DIRECT_IMPORT] Created ${stats.posts} posts...`);
        }
      } catch (error: any) {
        console.error(`[DIRECT_IMPORT] Error creating post:`, error.message || error);
        stats.skipped++;
      }
    }
  }

  // Third pass: create likes, reposts, follows, blocks
  for await (const { collection, rkey, record } of repo.walkRecords()) {
    try {
      const uri = `at://${DID}/${collection}/${rkey}`;
      
      switch (collection) {
        case 'app.bsky.feed.like':
          await storage.createLike({
            uri,
            user_did: DID,
            post_uri: (record as any).subject.uri,
            created_at: new Date((record as any).createdAt),
            indexed_at: new Date()
          });
          stats.likes++;
          if (stats.likes % 500 === 0) {
            console.log(`[DIRECT_IMPORT] Created ${stats.likes} likes...`);
          }
          break;
          
        case 'app.bsky.feed.repost':
          await storage.createRepost({
            uri,
            user_did: DID,
            post_uri: (record as any).subject.uri,
            created_at: new Date((record as any).createdAt),
            indexed_at: new Date()
          });
          stats.reposts++;
          if (stats.reposts % 100 === 0) {
            console.log(`[DIRECT_IMPORT] Created ${stats.reposts} reposts...`);
          }
          break;
          
        case 'app.bsky.graph.follow':
          await storage.createFollow({
            uri,
            follower_did: DID,
            target_did: (record as any).subject,
            created_at: new Date((record as any).createdAt),
            indexed_at: new Date()
          });
          stats.follows++;
          if (stats.follows % 100 === 0) {
            console.log(`[DIRECT_IMPORT] Created ${stats.follows} follows...`);
          }
          break;
          
        case 'app.bsky.graph.block':
          await storage.createBlock({
            uri,
            blocker_did: DID,
            target_did: (record as any).subject,
            created_at: new Date((record as any).createdAt),
            indexed_at: new Date()
          });
          stats.blocks++;
          break;
      }
    } catch (error: any) {
      if (stats.skipped < 10) { // Log first 10 errors
        console.error(`[DIRECT_IMPORT] Error on ${collection}/${rkey}:`, error.message || error);
      }
      stats.skipped++;
    }
  }

  console.log(`\n[DIRECT_IMPORT] ✅ Import complete!`);
  console.log(`  Users: ${stats.users}`);
  console.log(`  Posts: ${stats.posts}`);
  console.log(`  Likes: ${stats.likes}`);
  console.log(`  Reposts: ${stats.reposts}`);
  console.log(`  Follows: ${stats.follows}`);
  console.log(`  Blocks: ${stats.blocks}`);
  console.log(`  Skipped: ${stats.skipped}`);
  
  process.exit(0);
}

importRepo().catch(error => {
  console.error('[DIRECT_IMPORT] Fatal error:', error);
  process.exit(1);
});
