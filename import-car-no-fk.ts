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

    // Insert posts
    console.log(`[CAR_IMPORT] Importing ${records.posts.length} posts...`);
    let postsCreated = 0;
    for (const { rkey, record, cid } of records.posts) {
      const uri = `at://${DID}/app.bsky.feed.post/${rkey}`;
      await db.execute(sql`
        INSERT INTO posts (uri, cid, author_did, text, parent_uri, root_uri, created_at, indexed_at)
        VALUES (
          ${uri},
          ${cid?.toString() || 'unknown'},
          ${DID},
          ${(record as any).text || ''},
          ${(record as any).reply?.parent?.uri || null},
          ${(record as any).reply?.root?.uri || null},
          ${new Date((record as any).createdAt)},
          ${new Date()}
        )
        ON CONFLICT (uri) DO NOTHING
      `);
      postsCreated++;
      if (postsCreated % 500 === 0) {
        console.log(`[CAR_IMPORT]   ${postsCreated}/${records.posts.length} posts...`);
      }
    }
    console.log(`[CAR_IMPORT] ✓ Posts: ${postsCreated}`);

    // Insert likes (ALL of them, even external posts)
    console.log(`[CAR_IMPORT] Importing ${records.likes.length} likes...`);
    let likesCreated = 0;
    for (const { rkey, record } of records.likes) {
      const uri = `at://${DID}/app.bsky.feed.like/${rkey}`;
      await db.execute(sql`
        INSERT INTO likes (uri, user_did, post_uri, created_at, indexed_at)
        VALUES (
          ${uri},
          ${DID},
          ${(record as any).subject?.uri || ''},
          ${new Date((record as any).createdAt)},
          ${new Date()}
        )
        ON CONFLICT (uri) DO NOTHING
      `);
      likesCreated++;
      if (likesCreated % 1000 === 0) {
        console.log(`[CAR_IMPORT]   ${likesCreated}/${records.likes.length} likes...`);
      }
    }
    console.log(`[CAR_IMPORT] ✓ Likes: ${likesCreated}`);

    // Insert reposts (ALL of them)
    console.log(`[CAR_IMPORT] Importing ${records.reposts.length} reposts...`);
    let repostsCreated = 0;
    for (const { rkey, record } of records.reposts) {
      const uri = `at://${DID}/app.bsky.feed.repost/${rkey}`;
      await db.execute(sql`
        INSERT INTO reposts (uri, user_did, post_uri, created_at, indexed_at)
        VALUES (
          ${uri},
          ${DID},
          ${(record as any).subject?.uri || ''},
          ${new Date((record as any).createdAt)},
          ${new Date()}
        )
        ON CONFLICT (uri) DO NOTHING
      `);
      repostsCreated++;
      if (repostsCreated % 500 === 0) {
        console.log(`[CAR_IMPORT]   ${repostsCreated}/${records.reposts.length} reposts...`);
      }
    }
    console.log(`[CAR_IMPORT] ✓ Reposts: ${repostsCreated}`);

    // Insert follows
    console.log(`[CAR_IMPORT] Importing ${records.follows.length} follows...`);
    let followsCreated = 0;
    for (const { rkey, record } of records.follows) {
      const uri = `at://${DID}/app.bsky.graph.follow/${rkey}`;
      await db.execute(sql`
        INSERT INTO follows (uri, follower_did, following_did, created_at, indexed_at)
        VALUES (
          ${uri},
          ${DID},
          ${(record as any).subject || ''},
          ${new Date((record as any).createdAt)},
          ${new Date()}
        )
        ON CONFLICT (uri) DO NOTHING
      `);
      followsCreated++;
      if (followsCreated % 200 === 0) {
        console.log(`[CAR_IMPORT]   ${followsCreated}/${records.follows.length} follows...`);
      }
    }
    console.log(`[CAR_IMPORT] ✓ Follows: ${followsCreated}`);

    // Insert blocks
    console.log(`[CAR_IMPORT] Importing ${records.blocks.length} blocks...`);
    let blocksCreated = 0;
    for (const { rkey, record } of records.blocks) {
      const uri = `at://${DID}/app.bsky.graph.block/${rkey}`;
      await db.execute(sql`
        INSERT INTO blocks (uri, blocker_did, blocked_did, created_at, indexed_at)
        VALUES (
          ${uri},
          ${DID},
          ${(record as any).subject || ''},
          ${new Date((record as any).createdAt)},
          ${new Date()}
        )
        ON CONFLICT (uri) DO NOTHING
      `);
      blocksCreated++;
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
