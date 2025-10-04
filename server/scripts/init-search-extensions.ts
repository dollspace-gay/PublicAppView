import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Initialize required PostgreSQL extensions and indexes for search functionality
 * This should run once at startup to ensure pg_trgm is available
 */
export async function initSearchExtensions() {
  try {
    console.log("[SEARCH_INIT] Initializing search extensions...");
    
    // Enable pg_trgm extension for trigram matching
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    console.log("[SEARCH_INIT] ✓ pg_trgm extension enabled");
    
    // Create trigram index on handle for substring matching
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_users_handle_trgm 
      ON users USING gin (handle gin_trgm_ops);
    `);
    console.log("[SEARCH_INIT] ✓ Trigram index on users.handle created");
    
    // Create search vector trigger and function
    await db.execute(sql`
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
    console.log("[SEARCH_INIT] ✓ Search vector function created");
    
    // Create trigger if it doesn't exist
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger 
          WHERE tgname = 'users_search_vector_update'
        ) THEN
          CREATE TRIGGER users_search_vector_update
            BEFORE INSERT OR UPDATE OF handle, display_name, description
            ON users
            FOR EACH ROW
            EXECUTE FUNCTION users_search_vector_trigger();
        END IF;
      END $$;
    `);
    console.log("[SEARCH_INIT] ✓ Search vector trigger created");
    
    console.log("[SEARCH_INIT] Search extensions initialized successfully");
  } catch (error) {
    console.error("[SEARCH_INIT] Failed to initialize search extensions:", error);
    throw error;
  }
}
