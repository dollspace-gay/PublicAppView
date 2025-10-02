import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 100, // Increased from 20 to handle high firehose load
  idleTimeoutMillis: 10000, // Close idle connections after 10s
  connectionTimeoutMillis: 30000, // Increased timeout for acquiring connections
});
export const db = drizzle({ client: pool, schema });
