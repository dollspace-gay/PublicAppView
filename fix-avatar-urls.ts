/**
 * Script to fix avatar and banner URLs in the database
 * Re-extracts CIDs from stored profile_record JSON
 */

import { db } from './server/db';
import { users } from './shared/schema';
import { sql } from 'drizzle-orm';

/**
 * Extract CID from various blob reference formats used in AT Protocol
 */
function extractBlobCid(blob: any): string | null {
  if (!blob) return null;
  
  // Handle different blob formats
  if (typeof blob === 'string') {
    return blob === 'undefined' ? null : blob;
  }
  
  // {ref: {$link: 'cid'}} format
  if (blob.ref) {
    const cid = typeof blob.ref === 'string' ? blob.ref : blob.ref.$link;
    return (cid && cid !== 'undefined') ? cid : null;
  }
  
  // {cid: 'cid'} format
  if (blob.cid) {
    return blob.cid !== 'undefined' ? blob.cid : null;
  }
  
  return null;
}

async function fixAvatarUrls() {
  console.log('[FIX_AVATARS] Starting avatar/banner URL fix...');
  
  // Get all users with profile records
  const allUsers = await db.select({
    did: users.did,
    avatarUrl: users.avatarUrl,
    bannerUrl: users.bannerUrl,
    profileRecord: users.profileRecord
  }).from(users);
  
  console.log(`[FIX_AVATARS] Found ${allUsers.length} users`);
  
  let fixedCount = 0;
  let skippedCount = 0;
  
  for (const user of allUsers) {
    const profileRecord = user.profileRecord as any;
    
    if (!profileRecord) {
      skippedCount++;
      continue;
    }
    
    // Extract correct CIDs from profile record
    const correctAvatarCid = extractBlobCid(profileRecord.avatar);
    const correctBannerCid = extractBlobCid(profileRecord.banner);
    
    // Check if we need to update
    const needsAvatarUpdate = user.avatarUrl !== correctAvatarCid;
    const needsBannerUpdate = user.bannerUrl !== correctBannerCid;
    
    if (needsAvatarUpdate || needsBannerUpdate) {
      console.log(`[FIX_AVATARS] Fixing ${user.did}:`);
      if (needsAvatarUpdate) {
        console.log(`  Avatar: "${user.avatarUrl}" -> "${correctAvatarCid}"`);
      }
      if (needsBannerUpdate) {
        console.log(`  Banner: "${user.bannerUrl}" -> "${correctBannerCid}"`);
      }
      
      await db.update(users)
        .set({
          avatarUrl: correctAvatarCid,
          bannerUrl: correctBannerCid
        })
        .where(sql`${users.did} = ${user.did}`);
      
      fixedCount++;
    } else {
      skippedCount++;
    }
  }
  
  console.log(`[FIX_AVATARS] Complete!`);
  console.log(`  Fixed: ${fixedCount} users`);
  console.log(`  Skipped (already correct): ${skippedCount} users`);
}

// Run the fix
fixAvatarUrls()
  .then(() => {
    console.log('[FIX_AVATARS] Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[FIX_AVATARS] Script failed:', error);
    process.exit(1);
  });
