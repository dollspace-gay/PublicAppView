#!/usr/bin/env tsx
import { pool } from '../db';

async function fixSearchVectors() {
  console.log('='.repeat(60));
  console.log('Fix Search Vectors for Handle Matching');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Step 1: Create function to generate search vector with 'simple' config
    console.log('[1/3] Creating search vector function...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION users_search_vector_trigger() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('simple', COALESCE(NEW.handle,'')), 'A') ||
          setweight(to_tsvector('simple', COALESCE(NEW.display_name,'')), 'B') ||
          setweight(to_tsvector('simple', COALESCE(NEW.description,'')), 'C');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `);
    console.log('✓ Function created');
    console.log('');

    // Step 2: Create trigger to auto-update search_vector
    console.log('[2/3] Creating trigger...');
    await pool.query(`
      DROP TRIGGER IF EXISTS users_search_vector_update ON users;
      
      CREATE TRIGGER users_search_vector_update
        BEFORE INSERT OR UPDATE OF handle, display_name, description
        ON users
        FOR EACH ROW
        EXECUTE FUNCTION users_search_vector_trigger();
    `);
    console.log('✓ Trigger created');
    console.log('');

    // Step 3: Update all existing users' search vectors
    console.log('[3/3] Updating existing user search vectors...');
    const result = await pool.query(`
      UPDATE users
      SET search_vector = 
        setweight(to_tsvector('simple', COALESCE(handle,'')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(display_name,'')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(description,'')), 'C');
    `);
    console.log(`✓ Updated ${result.rowCount} users`);
    console.log('');

    console.log('='.repeat(60));
    console.log('✓ Search vectors fixed successfully!');
    console.log("  - Now using 'simple' dictionary for better handle matching");
    console.log('  - Auto-update trigger installed');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('✗ Error fixing search vectors:', error);
    process.exit(1);
  }
}

fixSearchVectors();
