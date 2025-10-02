import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';
import ws from "ws";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseUrl = process.env.DATABASE_URL;

// Auto-detect: Use standard pg driver for local/Docker PostgreSQL, Neon for cloud
const isNeonDatabase = databaseUrl.includes('.neon.tech') || 
                        databaseUrl.includes('neon.tech') ||
                        databaseUrl.includes('pooler.supabase.com'); // Neon-based services

// Pool size optimized for parallel pipelines and PostgreSQL connection limits
// 32 workers × 32 connections = 1024 total connections (within PostgreSQL max_connections)
// Each worker runs 5 parallel pipelines consuming batches of 300 events
// This provides enough concurrency without overwhelming the database
// Override with DB_POOL_SIZE environment variable if needed
const maxPoolSize = parseInt(process.env.DB_POOL_SIZE || '32');

console.log(`[DB] Connection pool size per process/worker: ${maxPoolSize}`);

let pool: NeonPool | PgPool;
let db: NeonDatabase<typeof schema> | NodePgDatabase<typeof schema>;

if (isNeonDatabase) {
  // Use Neon serverless driver for Neon cloud databases (Replit default)
  console.log('[DB] Using Neon serverless driver for cloud database');
  neonConfig.webSocketConstructor = ws;
  
  const neonPool = new NeonPool({ 
    connectionString: databaseUrl,
    max: maxPoolSize,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 60000, // Increased from 30s to 60s
  });
  
  pool = neonPool;
  db = drizzle(neonPool, { schema });
} else {
  // Use standard pg driver for local PostgreSQL (Docker, self-hosted)
  console.log('[DB] Using standard PostgreSQL driver for local database');
  
  const pgPool = new PgPool({ 
    connectionString: databaseUrl,
    max: maxPoolSize,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 60000, // Increased from 30s to 60s
  });
  
  pool = pgPool;
  db = drizzlePg(pgPool, { schema });
}

export { pool, db };
