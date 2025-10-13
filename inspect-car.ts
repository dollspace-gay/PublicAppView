#!/usr/bin/env tsx
import { AtpAgent } from '@atproto/api';
import { IdResolver } from '@atproto/identity';
import { readCar, MemoryBlockstore } from '@atproto/repo';
import { ReadableRepo } from '@atproto/repo/dist/readable-repo.js';

const DID = 'did:plc:dzvxvsiy3maw4iarpvizsj67'; // dollspace.gay
const didResolver = new IdResolver();

async function inspect() {
  console.log(`[INSPECT] Starting inspection for ${DID}...`);
  
  const didDoc = await didResolver.did.resolve(DID);
  const pdsService = didDoc.service.find((s: any) => 
    s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  
  if (!pdsService) {
    throw new Error('PDS service not found in DID document');
  }
  
  const pdsUrl = pdsService.serviceEndpoint;
  console.log(`[INSPECT] PDS: ${pdsUrl}`);
  
  const pdsAgent = new AtpAgent({ service: pdsUrl });
  const response = await pdsAgent.com.atproto.sync.getRepo({ did: DID });
  
  const carBytes = response.data as Uint8Array;
  const { roots, blocks } = await readCar(carBytes);
  const blockstore = new MemoryBlockstore(blocks);
  const repo = await ReadableRepo.load(blockstore, roots[0]);

  const collectionCounts = new Map<string, number>();
  const sampleRecords = new Map<string, any[]>();
  
  for await (const { collection, rkey, record, cid } of repo.walkRecords()) {
    collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + 1);
    
    // Keep first sample of each collection
    if (!sampleRecords.has(collection)) {
      sampleRecords.set(collection, []);
    }
    if (sampleRecords.get(collection)!.length < 2) {
      sampleRecords.get(collection)!.push({ collection, rkey, record: JSON.stringify(record, null, 2) });
    }
  }

  console.log(`\n[INSPECT] Collection breakdown:`);
  for (const [collection, count] of Array.from(collectionCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${collection}: ${count} records`);
  }

  console.log(`\n[INSPECT] Sample records:\n`);
  for (const [collection, samples] of sampleRecords.entries()) {
    console.log(`\n=== ${collection} ===`);
    for (const sample of samples) {
      console.log(`Key: ${sample.rkey}`);
      console.log(sample.record);
      console.log('---');
    }
  }
  
  process.exit(0);
}

inspect().catch(error => {
  console.error('[INSPECT] Error:', error);
  process.exit(1);
});
