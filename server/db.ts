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

// Type for database connection
export type DbConnection = NeonDatabase<typeof schema> | NodePgDatabase<typeof schema>;

/**
 * Factory function to create a database connection pool
 * @param poolSize - Maximum number of connections in the pool
 * @param label - Label for logging (e.g., "main", "backfill")
 */
export function createDbPool(poolSize: number, label: string = "pool"): DbConnection {
  console.log(`[DB] Creating ${label} connection pool: ${poolSize} connections`);
  
  if (isNeonDatabase) {
    // Configure WebSocket for Neon (only needs to be set once, but safe to set multiple times)
    neonConfig.webSocketConstructor = ws;
    
    const neonPool = new NeonPool({ 
      connectionString: databaseUrl,
      max: poolSize,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 120000, // 2 minutes - increased for backfill scenarios
    });
    
    return drizzle(neonPool, { schema });
  } else {
    const pgPool = new PgPool({ 
      connectionString: databaseUrl,
      max: poolSize,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 120000, // 2 minutes - increased for backfill scenarios
    });
    
    return drizzlePg(pgPool, { schema });
  }
}

// Main application pool size
// Default: 4 connections for Neon serverless (respects connection limits)
// For self-hosted PostgreSQL, increase via DB_POOL_SIZE env var
// Note: Total connections (main + backfill) must stay within database limits:
//   - Neon Free: ~10 connections
//   - Neon Pro: ~100 connections  
//   - Self-hosted: depends on max_connections setting
const mainPoolSize = parseInt(process.env.DB_POOL_SIZE || '4');

// Create main database connection pool
const db = createDbPool(mainPoolSize, isNeonDatabase ? "main (Neon)" : "main (PostgreSQL)");

// For backwards compatibility, export a pool variable (though the actual pool is internal to drizzle)
// This is used by some legacy code that checks pool status
export const pool = db as any;

// Export main db connection
export { db };
