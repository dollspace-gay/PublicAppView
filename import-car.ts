#!/usr/bin/env tsx
import { AtpAgent } from '@atproto/api';
import { IdResolver } from '@atproto/identity';
import { readCar, MemoryBlockstore } from '@atproto/repo';
import { ReadableRepo } from '@atproto/repo/dist/readable-repo.js';
import { db } from './server/db';
import { users, posts, likes, reposts, follows, blocks } from './shared/schema';
import { eq } from 'drizzle-orm';

const DID = 'did:plc:dzvxvsiy3maw4iarpvizsj67'; // dollspace.gay
const didResolver = new IdResolver();

async function importCar() {
  console.log(`[CAR_IMPORT] Starting import for ${DID}...`);
  
  // 1. Resolve DID and fetch CAR file
  const didDoc = await didResolver.did.resolve(DID);
  const pdsService = didDoc?.service?.find((s: any) => 
    s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  
  if (!pdsService?.serviceEndpoint) {
    throw new Error('PDS endpoint not found');
  }
  
  const pdsUrl = typeof pdsService.serviceEndpoint === 'string' 
    ? pdsService.serviceEndpoint 
    : pdsService.serviceEndpoint.toString();
  
  console.log(`[CAR_IMPORT] PDS: ${pdsUrl}`);
  
  const pdsAgent = new AtpAgent({ service: pdsUrl });
  const response = await pdsAgent.com.atproto.sync.getRepo({ did: DID });
  
  if (!response.success || !(response.data instanceof Uint8Array)) {
    throw new Error('Failed to fetch repo');
  }

  const carBytes = response.data;
  console.log(`[CAR_IMPORT] Downloaded ${carBytes.length} bytes`);
  
  const { roots, blocks } = await readCar(carBytes);
  console.log(`[CAR_IMPORT] Parsing repo (${blocks.size} blocks, ${roots.length} roots)...`);

  const blockstore = new MemoryBlockstore(blocks);
  const repo = await ReadableRepo.load(blockstore, roots[0]);

  // 2. Collect all records by type
  const records = {
    profile: [] as any[],
    posts: [] as any[],
    likes: [] as any[],
    reposts: [] as any[],
    follows: [] as any[],
    blocks: [] as any[]
  };

  for await (const { collection, rkey, record, cid } of repo.walkRecords()) {
    const item = { collection, rkey, record, cid };
    
    switch (collection) {
      case 'app.bsky.actor.profile':
        records.profile.push(item);
        break;
      case 'app.bsky.feed.post':
        records.posts.push(item);
        break;
      case 'app.bsky.feed.like':
        records.likes.push(item);
        break;
      case 'app.bsky.feed.repost':
        records.reposts.push(item);
        break;
      case 'app.bsky.graph.follow':
        records.follows.push(item);
        break;
      case 'app.bsky.graph.block':
        records.blocks.push(item);
        break;
    }
  }

  console.log(`[CAR_IMPORT] Collected records:
  - Profile: ${records.profile.length}
  - Posts: ${records.posts.length}
  - Likes: ${records.likes.length}
  - Reposts: ${records.reposts.length}
  - Follows: ${records.follows.length}
  - Blocks: ${records.blocks.length}`);

  // 3. Import in order: User -> Posts -> Interactions
  
  // Step 1: Create user
  console.log(`[CAR_IMPORT] Creating user...`);
  const handle = await didResolver.handle.resolve(DID) || DID;
  const profile = records.profile[0]?.record;
  
  await db.insert(users)
    .values({
      did: DID,
      handle: handle,
      displayName: profile?.displayName || null,
      avatarUrl: null,
      indexedAt: new Date()
    })
    .onConflictDoUpdate({
      target: users.did,
      set: {
        handle: handle,
        displayName: profile?.displayName || null
      }
    });
  
  console.log(`[CAR_IMPORT] ✓ Created user: ${handle}`);

  // Step 2: Create posts
  console.log(`[CAR_IMPORT] Creating ${records.posts.length} posts...`);
  let postsCreated = 0;
  
  for (const { rkey, record, cid } of records.posts) {
    try {
      const uri = `at://${DID}/app.bsky.feed.post/${rkey}`;
      await db.insert(posts)
        .values({
          uri,
          cid: cid?.toString() || 'unknown',
          authorDid: DID,
          text: (record as any).text || '',
          parentUri: (record as any).reply?.parent?.uri || null,
          rootUri: (record as any).reply?.root?.uri || null,
          createdAt: new Date((record as any).createdAt),
          indexedAt: new Date()
        })
        .onConflictDoNothing();
      
      postsCreated++;
      if (postsCreated % 500 === 0) {
        console.log(`[CAR_IMPORT]   ${postsCreated}/${records.posts.length} posts...`);
      }
    } catch (error: any) {
      console.error(`[CAR_IMPORT] Post error:`, error.message);
    }
  }
  console.log(`[CAR_IMPORT] ✓ Created ${postsCreated} posts`);

  // Step 3: Create likes (all of them, including external posts)
  console.log(`[CAR_IMPORT] Creating ${records.likes.length} likes...`);
  let likesCreated = 0;
  
  for (const { rkey, record } of records.likes) {
    try {
      const uri = `at://${DID}/app.bsky.feed.like/${rkey}`;
      const postUri = (record as any).subject?.uri || '';
      
      await db.insert(likes)
        .values({
          uri,
          userDid: DID,
          postUri,
          createdAt: new Date((record as any).createdAt),
          indexedAt: new Date()
        })
        .onConflictDoNothing();
      likesCreated++;
      
      if (likesCreated % 1000 === 0) {
        console.log(`[CAR_IMPORT]   ${likesCreated}/${records.likes.length} likes...`);
      }
    } catch (error: any) {
      // Skip errors silently
    }
  }
  console.log(`[CAR_IMPORT] ✓ Created ${likesCreated} likes`);

  // Step 4: Create reposts (all of them, including external posts)
  console.log(`[CAR_IMPORT] Creating ${records.reposts.length} reposts...`);
  let repostsCreated = 0;
  
  for (const { rkey, record } of records.reposts) {
    try {
      const uri = `at://${DID}/app.bsky.feed.repost/${rkey}`;
      const postUri = (record as any).subject?.uri || '';
      
      await db.insert(reposts)
        .values({
          uri,
          userDid: DID,
          postUri,
          createdAt: new Date((record as any).createdAt),
          indexedAt: new Date()
        })
        .onConflictDoNothing();
      repostsCreated++;
      
      if (repostsCreated % 500 === 0) {
        console.log(`[CAR_IMPORT]   ${repostsCreated}/${records.reposts.length} reposts...`);
      }
    } catch (error: any) {
      // Skip errors silently
    }
  }
  console.log(`[CAR_IMPORT] ✓ Created ${repostsCreated} reposts`);

  // Step 5: Create follows
  console.log(`[CAR_IMPORT] Creating ${records.follows.length} follows...`);
  let followsCreated = 0;
  
  for (const { rkey, record } of records.follows) {
    try {
      const uri = `at://${DID}/app.bsky.graph.follow/${rkey}`;
      await db.insert(follows)
        .values({
          uri,
          followerDid: DID,
          followingDid: (record as any).subject || '',
          createdAt: new Date((record as any).createdAt),
          indexedAt: new Date()
        })
        .onConflictDoNothing();
      
      followsCreated++;
      if (followsCreated % 200 === 0) {
        console.log(`[CAR_IMPORT]   ${followsCreated}/${records.follows.length} follows...`);
      }
    } catch (error: any) {
      // Skip errors silently
    }
  }
  console.log(`[CAR_IMPORT] ✓ Created ${followsCreated} follows`);

  // Step 6: Create blocks
  console.log(`[CAR_IMPORT] Creating ${records.blocks.length} blocks...`);
  let blocksCreated = 0;
  
  for (const { rkey, record } of records.blocks) {
    try {
      const uri = `at://${DID}/app.bsky.graph.block/${rkey}`;
      await db.insert(blocks)
        .values({
          uri,
          blockerDid: DID,
          targetDid: (record as any).subject || '',
          createdAt: new Date((record as any).createdAt),
          indexedAt: new Date()
        })
        .onConflictDoNothing();
      
      blocksCreated++;
    } catch (error: any) {
      // Skip errors silently
    }
  }
  console.log(`[CAR_IMPORT] ✓ Created ${blocksCreated} blocks`);

  // Summary
  console.log(`
[CAR_IMPORT] ✅ Import complete!
  User: ${handle}
  Posts: ${postsCreated}
  Likes: ${likesCreated}
  Reposts: ${repostsCreated}
  Follows: ${followsCreated}
  Blocks: ${blocksCreated}
`);
  
  process.exit(0);
}

importCar().catch(error => {
  console.error('[CAR_IMPORT] Fatal error:', error);
  process.exit(1);
});
