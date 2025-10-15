#!/usr/bin/env node

/**
 * Database Migration Runner
 * 
 * This script runs the database migration to add missing fields.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION_FILE = path.join(__dirname, 'migrations', 'add_missing_aggregation_fields.sql');

async function runMigration() {
  console.log('🔄 Running database migration...');
  
  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error('❌ Migration file not found:', MIGRATION_FILE);
    process.exit(1);
  }
  
  const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');
  console.log('📄 Migration SQL:');
  console.log(migrationSQL);
  
  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }
  
  console.log('✅ Migration file found and DATABASE_URL is set');
  console.log('⚠️  Please run the migration manually using your preferred PostgreSQL client:');
  console.log(`   psql "${process.env.DATABASE_URL}" -f ${MIGRATION_FILE}`);
  console.log('\nOr copy and paste the SQL above into your database client.');
}

runMigration().catch(error => {
  console.error('💥 Migration runner failed:', error);
  process.exit(1);
});