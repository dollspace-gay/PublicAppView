#!/usr/bin/env tsx
import { AtpAgent } from '@atproto/api';
import { IdResolver } from '@atproto/identity';
import { readCar, MemoryBlockstore } from '@atproto/repo';
import { ReadableRepo } from '@atproto/repo/dist/readable-repo.js';
import { db } from './server/db';
import { sql } from 'drizzle-orm';

const DID = 'did:plc:dzvxvsiy3maw4iarpvizsj67'; // dollspace.gay
const didResolver = new IdResolver();

async function importCar() {
  console.log(`[CAR_IMPORT] Starting import for ${DID}...`);
  
  // 1. Fetch CAR file
  const didDoc = await didResolver.did.resolve(DID);
  const pdsService = didDoc?.service?.find((s: any) => 
    s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  
  if (!pdsService || !pdsService.serviceEndpoint) {
    throw new Error('PDS service not found in DID document');
  }
  
  const pdsUrl = typeof pdsService.serviceEndpoint === 'string' 
    ? pdsService.serviceEndpoint 
    : pdsService.serviceEndpoint.toString();
  
  console.log(`[CAR_IMPORT] PDS: ${pdsUrl}`);
  
  const pdsAgent = new AtpAgent({ service: pdsUrl });
  const response = await pdsAgent.com.atproto.sync.getRepo({ did: DID });
  
  const carBytes = response.data as Uint8Array;
  console.log(`[CAR_IMPORT] Downloaded ${carBytes.length} bytes`);
  
  const { roots, blocks } = await readCar(carBytes);
  const blockstore = new MemoryBlockstore(blocks);
  const repo = await ReadableRepo.load(blockstore, roots[0]);

  // 2. Collect records
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

  console.log(`[CAR_IMPORT] Collected: ${records.posts.length} posts, ${records.likes.length} likes, ${records.reposts.length} reposts, ${records.follows.length} follows, ${records.blocks.length} blocks`);

  // 3. Temporarily disable foreign key constraints
  console.log(`[CAR_IMPORT] Disabling foreign key constraints...`);
  await db.execute(sql`SET session_replication_role = replica;`);

  try {
    // Create user
    const handle = await didResolver.handle.resolve(DID) || DID;
    const profile = records.profile[0]?.record;
    
    await db.execute(sql`
      INSERT INTO users (did, handle, display_name, avatar_url, indexed_at)
      VALUES (${DID}, ${handle}, ${profile?.displayName || null}, null, ${new Date()})
      ON CONFLICT (did) DO UPDATE SET
        handle = ${handle},
        display_name = ${profile?.displayName || null}
    `);
    console.log(`[CAR_IMPORT] ✓ User: ${handle}`);

    // Batch insert posts
    console.log(`[CAR_IMPORT] Importing ${records.posts.length} posts...`);
    const BATCH_SIZE = 500;
    let postsCreated = 0;
    
    for (let i = 0; i < records.posts.length; i += BATCH_SIZE) {
      const batch = records.posts.slice(i, i + BATCH_SIZE);
      
      if (batch.length > 0) {
        const uris = batch.map(({ rkey }) => `at://${DID}/app.bsky.feed.post/${rkey}`);
        const cids = batch.map(({ cid }) => cid?.toString() || 'unknown');
        const texts = batch.map(({ record }) => (record as any).text || '');
        const parentUris = batch.map(({ record }) => (record as any).reply?.parent?.uri || null);
        const rootUris = batch.map(({ record }) => (record as any).reply?.root?.uri || null);
        const createdAts = batch.map(({ record }) => new Date((record as any).createdAt));
        const indexedAt = new Date();
        
        await db.execute(sql`
          INSERT INTO posts (uri, cid, author_did, text, parent_uri, root_uri, created_at, indexed_at)
          SELECT 
            unnest(${uris}::text[]),
            unnest(${cids}::text[]),
            ${DID},
            unnest(${texts}::text[]),
            unnest(${parentUris}::text[]),
            unnest(${rootUris}::text[]),
            unnest(${createdAts}::timestamp[]),
            ${indexedAt}
          ON CONFLICT (uri) DO NOTHING
        `);
        
        postsCreated += batch.length;
        console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.posts.length)}/${records.posts.length} posts...`);
      }
    }
    console.log(`[CAR_IMPORT] ✓ Posts: ${postsCreated}`);

    // Batch insert likes (ALL of them, even external posts)
    console.log(`[CAR_IMPORT] Importing ${records.likes.length} likes...`);
    let likesCreated = 0;
    
    for (let i = 0; i < records.likes.length; i += BATCH_SIZE) {
      const batch = records.likes.slice(i, i + BATCH_SIZE);
      
      if (batch.length > 0) {
        const uris = batch.map(({ rkey }) => `at://${DID}/app.bsky.feed.like/${rkey}`);
        const postUris = batch.map(({ record }) => (record as any).subject?.uri || '');
        const createdAts = batch.map(({ record }) => new Date((record as any).createdAt));
        const indexedAt = new Date();
        
        await db.execute(sql`
          INSERT INTO likes (uri, user_did, post_uri, created_at, indexed_at)
          SELECT 
            unnest(${uris}::text[]),
            ${DID},
            unnest(${postUris}::text[]),
            unnest(${createdAts}::timestamp[]),
            ${indexedAt}
          ON CONFLICT (uri) DO NOTHING
        `);
        
        likesCreated += batch.length;
        if (i + BATCH_SIZE >= records.likes.length || (i + BATCH_SIZE) % 1000 === 0) {
          console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.likes.length)}/${records.likes.length} likes...`);
        }
      }
    }
    console.log(`[CAR_IMPORT] ✓ Likes: ${likesCreated}`);

    // Batch insert reposts (ALL of them)
    console.log(`[CAR_IMPORT] Importing ${records.reposts.length} reposts...`);
    let repostsCreated = 0;
    
    for (let i = 0; i < records.reposts.length; i += BATCH_SIZE) {
      const batch = records.reposts.slice(i, i + BATCH_SIZE);
      
      if (batch.length > 0) {
        const uris = batch.map(({ rkey }) => `at://${DID}/app.bsky.feed.repost/${rkey}`);
        const postUris = batch.map(({ record }) => (record as any).subject?.uri || '');
        const createdAts = batch.map(({ record }) => new Date((record as any).createdAt));
        const indexedAt = new Date();
        
        await db.execute(sql`
          INSERT INTO reposts (uri, user_did, post_uri, created_at, indexed_at)
          SELECT 
            unnest(${uris}::text[]),
            ${DID},
            unnest(${postUris}::text[]),
            unnest(${createdAts}::timestamp[]),
            ${indexedAt}
          ON CONFLICT (uri) DO NOTHING
        `);
        
        repostsCreated += batch.length;
        console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.reposts.length)}/${records.reposts.length} reposts...`);
      }
    }
    console.log(`[CAR_IMPORT] ✓ Reposts: ${repostsCreated}`);

    // Batch insert follows
    console.log(`[CAR_IMPORT] Importing ${records.follows.length} follows...`);
    let followsCreated = 0;
    
    for (let i = 0; i < records.follows.length; i += BATCH_SIZE) {
      const batch = records.follows.slice(i, i + BATCH_SIZE);
      
      if (batch.length > 0) {
        const uris = batch.map(({ rkey }) => `at://${DID}/app.bsky.graph.follow/${rkey}`);
        const followingDids = batch.map(({ record }) => (record as any).subject || '');
        const createdAts = batch.map(({ record }) => new Date((record as any).createdAt));
        const indexedAt = new Date();
        
        await db.execute(sql`
          INSERT INTO follows (uri, follower_did, following_did, created_at, indexed_at)
          SELECT 
            unnest(${uris}::text[]),
            ${DID},
            unnest(${followingDids}::text[]),
            unnest(${createdAts}::timestamp[]),
            ${indexedAt}
          ON CONFLICT (uri) DO NOTHING
        `);
        
        followsCreated += batch.length;
        console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.follows.length)}/${records.follows.length} follows...`);
      }
    }
    console.log(`[CAR_IMPORT] ✓ Follows: ${followsCreated}`);

    // Batch insert blocks
    console.log(`[CAR_IMPORT] Importing ${records.blocks.length} blocks...`);
    let blocksCreated = 0;
    
    for (let i = 0; i < records.blocks.length; i += BATCH_SIZE) {
      const batch = records.blocks.slice(i, i + BATCH_SIZE);
      
      if (batch.length > 0) {
        const uris = batch.map(({ rkey }) => `at://${DID}/app.bsky.graph.block/${rkey}`);
        const blockedDids = batch.map(({ record }) => (record as any).subject || '');
        const createdAts = batch.map(({ record }) => new Date((record as any).createdAt));
        const indexedAt = new Date();
        
        await db.execute(sql`
          INSERT INTO blocks (uri, blocker_did, blocked_did, created_at, indexed_at)
          SELECT 
            unnest(${uris}::text[]),
            ${DID},
            unnest(${blockedDids}::text[]),
            unnest(${createdAts}::timestamp[]),
            ${indexedAt}
          ON CONFLICT (uri) DO NOTHING
        `);
        
        blocksCreated += batch.length;
      }
    }
    console.log(`[CAR_IMPORT] ✓ Blocks: ${blocksCreated}`);

    console.log(`
[CAR_IMPORT] ✅ Import complete!
  User: ${handle}
  Posts: ${postsCreated}
  Likes: ${likesCreated}
  Reposts: ${repostsCreated}
  Follows: ${followsCreated}
  Blocks: ${blocksCreated}
`);
  } finally {
    // Re-enable foreign key constraints
    console.log(`[CAR_IMPORT] Re-enabling foreign key constraints...`);
    await db.execute(sql`SET session_replication_role = DEFAULT;`);
  }
  
  process.exit(0);
}

importCar().catch(error => {
  console.error('[CAR_IMPORT] Fatal error:', error);
  process.exit(1);
});
