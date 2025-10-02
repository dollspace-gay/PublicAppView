import { drizzle } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
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

// Pool size optimized for EXTREME throughput with max_connections=8000 and 47GB RAM
// For cluster mode (32 workers × 240 connections = 7680 total) - leaves 320 for overhead
// Override with DB_POOL_SIZE environment variable if needed
const maxPoolSize = parseInt(process.env.DB_POOL_SIZE || '240');

console.log(`[DB] Connection pool size per process/worker: ${maxPoolSize}`);

let pool: any;
let db: any;

if (isNeonDatabase) {
  // Use Neon serverless driver for Neon cloud databases (Replit default)
  console.log('[DB] Using Neon serverless driver for cloud database');
  neonConfig.webSocketConstructor = ws;
  
  pool = new NeonPool({ 
    connectionString: databaseUrl,
    max: maxPoolSize,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 60000, // Increased from 30s to 60s
  });
  
  db = drizzle({ client: pool, schema });
} else {
  // Use standard pg driver for local PostgreSQL (Docker, self-hosted)
  console.log('[DB] Using standard PostgreSQL driver for local database');
  
  pool = new PgPool({ 
    connectionString: databaseUrl,
    max: maxPoolSize,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 60000, // Increased from 30s to 60s
  });
  
  db = drizzlePg({ client: pool, schema });
}

export { pool, db };
