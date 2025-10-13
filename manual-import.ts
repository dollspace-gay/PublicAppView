#!/usr/bin/env tsx
import { AtpAgent } from '@atproto/api';
import { IdResolver } from '@atproto/identity';
import { readCar, MemoryBlockstore } from '@atproto/repo';
import { ReadableRepo } from '@atproto/repo/dist/readable-repo.js';
import { EventProcessor } from './server/services/event-processor';
import { createStorage } from './server/storage';
import { createDbPool } from './server/db';
import { removeNullBytesFromObject } from './server/utils/sanitize';

const DID = 'did:plc:dzvxvsiy3maw4iarpvizsj67'; // dollspace.gay

// Create dedicated connection pool and event processor for import
const importDb = createDbPool(2, "manual-import");
const importStorage = createStorage(importDb);
const eventProcessor = new EventProcessor(importStorage);
const didResolver = new IdResolver();

function generateSyntheticCid(record: any, did: string, path: string): string {
  const content = JSON.stringify({ record, did, path });
  return `bafyrei${Buffer.from(content).toString('base64').substring(0, 50)}`;
}

async function importRepo() {
  console.log(`[IMPORT] Starting import for ${DID}...`);
  
  // Resolve DID to find the PDS endpoint
  console.log(`[IMPORT] Resolving DID...`);
  const didDoc = await didResolver.did.resolve(DID);
  
  if (!didDoc || !didDoc.service) {
    throw new Error(`Could not resolve DID document for ${DID}`);
  }
  
  // Find the PDS service endpoint
  const pdsService = didDoc.service.find((s: any) => 
    s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer'
  );
  
  if (!pdsService || !pdsService.serviceEndpoint) {
    throw new Error(`No PDS endpoint found for ${DID}`);
  }
  
  const pdsUrl = pdsService.serviceEndpoint;
  console.log(`[IMPORT] Resolved to PDS: ${pdsUrl}`);
  
  // Create agent for the user's PDS
  const pdsAgent = new AtpAgent({ service: pdsUrl });
  
  // Fetch complete repository as CAR file from the PDS
  console.log(`[IMPORT] Downloading CAR file from PDS...`);
  const response = await pdsAgent.com.atproto.sync.getRepo({ did: DID });
  
  if (!response.success || !(response.data instanceof Uint8Array)) {
    throw new Error(`Failed to fetch repo or received invalid data`);
  }

  // Parse CAR file
  const carBytes = response.data;
  console.log(`[IMPORT] Downloaded ${carBytes.length} bytes`);
  
  const { roots, blocks } = await readCar(carBytes);
  console.log(`[IMPORT] Parsing repo (${blocks.size} blocks, ${roots.length} roots)...`);

  if (roots.length === 0) {
    throw new Error(`No root CID found in repo`);
  }

  // Create a blockstore and load the repo
  const blockstore = new MemoryBlockstore(blocks);
  const repo = await ReadableRepo.load(blockstore, roots[0]);

  console.log(`[IMPORT] Walking records...`);
  let recordsProcessed = 0;

  const collectionCounts = new Map<string, number>();
  
  for await (const { collection, rkey, record, cid } of repo.walkRecords()) {
    try {
      // Count collections
      collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + 1);
      
      // Remove null bytes from record before processing (PostgreSQL requirement)
      const sanitized = removeNullBytesFromObject(record);
      
      const path = `${collection}/${rkey}`;
      const finalCid = cid?.toString() || generateSyntheticCid(sanitized, DID, path);

      // Create commit event structure with CID
      const commitEvent = {
        repo: DID,
        ops: [{
          action: 'create' as const,
          path: `${collection}/${rkey}`,
          cid: finalCid,
          record: sanitized,
        }],
      };

      // Process through event processor
      await eventProcessor.processCommit(commitEvent);
      recordsProcessed++;

      // Log progress every 100 records
      if (recordsProcessed % 100 === 0) {
        console.log(`[IMPORT] Progress: ${recordsProcessed} records processed...`);
      }

    } catch (error: any) {
      // Skip unparseable records
      if (error?.code !== '23505') { // Ignore duplicates
        console.error(`[IMPORT] Error processing ${collection}/${rkey}:`, error.message);
      }
    }
  }

  console.log(`[IMPORT] Collection breakdown:`);
  for (const [collection, count] of Array.from(collectionCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`[IMPORT]   - ${collection}: ${count} records`);
  }

  console.log(`[IMPORT] ✅ Import complete! Processed ${recordsProcessed} records`);
  process.exit(0);
}

importRepo().catch(error => {
  console.error('[IMPORT] Fatal error:', error);
  process.exit(1);
});
