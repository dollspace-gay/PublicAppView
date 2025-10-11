import { Pool } from 'pg';

async function checkHandles() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/bluesky'
  });

  try {
    const result = await pool.query(`
      SELECT did, handle, display_name 
      FROM users 
      WHERE handle IS NULL OR handle = '' 
      LIMIT 10
    `);
    console.log('Users with null/empty handles:', result.rows);
    
    const totalResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM users 
      WHERE handle IS NULL OR handle = ''
    `);
    console.log('Total users with null/empty handles:', totalResult.rows[0].count);
    
    // Also check for users with handles that look like DIDs
    const didResult = await pool.query(`
      SELECT did, handle, display_name 
      FROM users 
      WHERE handle LIKE 'did:%' 
      LIMIT 10
    `);
    console.log('Users with DID-like handles:', didResult.rows);
    
    const didTotalResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM users 
      WHERE handle LIKE 'did:%'
    `);
    console.log('Total users with DID-like handles:', didTotalResult.rows[0].count);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkHandles();