import './server/db';
import { db } from './server/db';
import { users, posts, likes, reposts, follows, blocks } from './shared/schema';
import { AtpAgent } from '@atproto/api';
import { IdResolver } from '@atproto/identity';
import { readCar, MemoryBlockstore } from '@atproto/repo';
import { ReadableRepo } from '@atproto/repo/dist/readable-repo.js';

const DID = 'did:plc:dzvxvsiy3maw4iarpvizsj67';
const BATCH_SIZE = 500;
const didResolver = new IdResolver();

async function importCar() {
  console.log(`[CAR_IMPORT] Starting import for ${DID}...`);
  
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
  
  // Create user
  const profile = records.profile[0]?.record || {};
  await db.insert(users).values({
    did: DID,
    handle: DID,
    displayName: profile.displayName || 'Doll',
    description: profile.description || '',
    avatarUrl: extractBlobCid(profile.avatar),
    bannerUrl: extractBlobCid(profile.banner),
    profileRecord: profile || null,
    indexedAt: new Date()
  }).onConflictDoNothing();
  console.log(`[CAR_IMPORT] ✓ Created user (avatar: ${extractBlobCid(profile.avatar) ? 'yes' : 'no'}, banner: ${extractBlobCid(profile.banner) ? 'yes' : 'no'})`);
  
  // Batch insert posts
  console.log(`[CAR_IMPORT] Creating ${records.posts.length} posts...`);
  for (let i = 0; i < records.posts.length; i += BATCH_SIZE) {
    const batch = records.posts.slice(i, i + BATCH_SIZE);
    const values = batch.map(({ rkey, record, cid }) => ({
      uri: `at://${DID}/app.bsky.feed.post/${rkey}`,
      cid: cid.toString(),
      authorDid: DID,
      text: record.text || '',
      replyParentUri: record.reply?.parent?.uri || null,
      replyRootUri: record.reply?.root?.uri || null,
      createdAt: new Date(record.createdAt),
      indexedAt: new Date()
    }));
    
    await db.insert(posts).values(values).onConflictDoNothing();
    console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.posts.length)}/${records.posts.length} posts...`);
  }
  console.log(`[CAR_IMPORT] ✓ Created posts`);
  
  // Batch insert likes
  console.log(`[CAR_IMPORT] Creating ${records.likes.length} likes...`);
  for (let i = 0; i < records.likes.length; i += BATCH_SIZE) {
    const batch = records.likes.slice(i, i + BATCH_SIZE);
    const values = batch.map(({ rkey, record }) => ({
      uri: `at://${DID}/app.bsky.feed.like/${rkey}`,
      userDid: DID,
      postUri: record.subject?.uri || '',
      createdAt: new Date(record.createdAt),
      indexedAt: new Date()
    }));
    
    await db.insert(likes).values(values).onConflictDoNothing();
    console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.likes.length)}/${records.likes.length} likes...`);
  }
  console.log(`[CAR_IMPORT] ✓ Created likes`);
  
  // Batch insert reposts
  console.log(`[CAR_IMPORT] Creating ${records.reposts.length} reposts...`);
  for (let i = 0; i < records.reposts.length; i += BATCH_SIZE) {
    const batch = records.reposts.slice(i, i + BATCH_SIZE);
    const values = batch.map(({ rkey, record }) => ({
      uri: `at://${DID}/app.bsky.feed.repost/${rkey}`,
      userDid: DID,
      postUri: record.subject?.uri || '',
      createdAt: new Date(record.createdAt),
      indexedAt: new Date()
    }));
    
    await db.insert(reposts).values(values).onConflictDoNothing();
    console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.reposts.length)}/${records.reposts.length} reposts...`);
  }
  console.log(`[CAR_IMPORT] ✓ Created reposts`);
  
  // Batch insert follows
  console.log(`[CAR_IMPORT] Creating ${records.follows.length} follows...`);
  for (let i = 0; i < records.follows.length; i += BATCH_SIZE) {
    const batch = records.follows.slice(i, i + BATCH_SIZE);
    const values = batch.map(({ rkey, record }) => ({
      uri: `at://${DID}/app.bsky.graph.follow/${rkey}`,
      followerDid: DID,
      followingDid: record.subject || '',
      createdAt: new Date(record.createdAt),
      indexedAt: new Date()
    }));
    
    await db.insert(follows).values(values).onConflictDoNothing();
    console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.follows.length)}/${records.follows.length} follows...`);
  }
  console.log(`[CAR_IMPORT] ✓ Created follows`);
  
  // Batch insert blocks
  console.log(`[CAR_IMPORT] Creating ${records.blocks.length} blocks...`);
  for (let i = 0; i < records.blocks.length; i += BATCH_SIZE) {
    const batch = records.blocks.slice(i, i + BATCH_SIZE);
    const values = batch
      .filter(({ record }) => record && record.subject && record.createdAt)
      .map(({ rkey, record }) => ({
        uri: `at://${DID}/app.bsky.graph.block/${rkey}`,
        blockerDid: DID,
        blockedDid: record.subject,
        createdAt: new Date(record.createdAt),
        indexedAt: new Date()
      }));
    
    if (values.length > 0) {
      await db.insert(blocks).values(values).onConflictDoNothing();
    }
    console.log(`[CAR_IMPORT]   ${Math.min(i + BATCH_SIZE, records.blocks.length)}/${records.blocks.length} blocks...`);
  }
  console.log(`[CAR_IMPORT] ✓ Created blocks`);
  
  console.log(`[CAR_IMPORT] Import complete!`);
  process.exit(0);
}

importCar().catch(console.error);
