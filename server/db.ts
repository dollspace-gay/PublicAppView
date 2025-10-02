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

let pool: any;
let db: any;

if (isNeonDatabase) {
  // Use Neon serverless driver for Neon cloud databases (Replit default)
  console.log('[DB] Using Neon serverless driver for cloud database');
  neonConfig.webSocketConstructor = ws;
  
  pool = new NeonPool({ 
    connectionString: databaseUrl,
    max: 100,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
  });
  
  db = drizzle({ client: pool, schema });
} else {
  // Use standard pg driver for local PostgreSQL (Docker, self-hosted)
  console.log('[DB] Using standard PostgreSQL driver for local database');
  
  pool = new PgPool({ 
    connectionString: databaseUrl,
    max: 100,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
  });
  
  db = drizzlePg({ client: pool, schema });
}

export { pool, db };
