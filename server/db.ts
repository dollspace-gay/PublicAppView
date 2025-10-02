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

// Safe pool size that works for both single process and cluster mode
// For cluster mode (8 workers × 10 connections = 80 total) - well under most DB limits
// For single process (1 worker × 10 connections = 10 total) - efficient and safe
// Override with DB_POOL_SIZE environment variable if needed
const maxPoolSize = parseInt(process.env.DB_POOL_SIZE || '10');

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
    connectionTimeoutMillis: 30000,
  });
  
  db = drizzle({ client: pool, schema });
} else {
  // Use standard pg driver for local PostgreSQL (Docker, self-hosted)
  console.log('[DB] Using standard PostgreSQL driver for local database');
  
  pool = new PgPool({ 
    connectionString: databaseUrl,
    max: maxPoolSize,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
  });
  
  db = drizzlePg({ client: pool, schema });
}

export { pool, db };
