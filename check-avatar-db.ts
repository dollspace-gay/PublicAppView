#!/usr/bin/env tsx
/**
 * Quick script to check what's in the database for avatar URLs
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function checkAvatars() {
  console.log('[CHECK_AVATARS] Querying database...\n');
  
  const result = await db.execute(sql`
    SELECT 
      did, 
      handle, 
      avatar_url, 
      banner_url,
      profile_record->>'avatar' as profile_avatar,
      profile_record->>'banner' as profile_banner
    FROM users 
    WHERE did = 'did:plc:dzvxvsiy3maw4iarpvizsj67'
    LIMIT 1
  `);
  
  if (result.rows.length === 0) {
    console.log('❌ User not found in database!');
  } else {
    const user = result.rows[0];
    console.log('✅ User found:');
    console.log('   DID:', user.did);
    console.log('   Handle:', user.handle);
    console.log('   avatar_url column:', user.avatar_url || '(null)');
    console.log('   banner_url column:', user.banner_url || '(null)');
    console.log('   profile_record.avatar:', user.profile_avatar || '(not in JSON)');
    console.log('   profile_record.banner:', user.profile_banner || '(not in JSON)');
    
    console.log('\n' + '='.repeat(60));
    
    if (!user.avatar_url) {
      console.log('⚠️  PROBLEM: avatar_url is NULL in database!');
      console.log('   The CID needs to be extracted from profile_record and stored.');
    } else if (user.avatar_url === 'undefined') {
      console.log('⚠️  PROBLEM: avatar_url is the string "undefined"!');
      console.log('   This is corrupted data that needs to be fixed.');
    } else {
      console.log('✅ avatar_url looks good!');
      console.log(`   Expected URL: https://appview.dollspace.gay/img/avatar/plain/${user.did}/${user.avatar_url}@jpeg`);
    }
  }
  
  await pool.end();
}

checkAvatars()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
