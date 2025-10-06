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
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
      console.log("[SEARCH_INIT] ✓ pg_trgm extension enabled");
    } catch (error: any) {
      // Ignore if extension already exists (race condition during concurrent creation)
      if (error.code !== '42710') {
        throw error;
      }
      console.log("[SEARCH_INIT] ✓ pg_trgm extension already exists");
    }
    
    // Create trigram index on handle for substring matching
    try {
      await db.execute(sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_handle_trgm 
        ON users USING gin (handle gin_trgm_ops);
      `);
      console.log("[SEARCH_INIT] ✓ Trigram index on users.handle created");
    } catch (error: any) {
      // Ignore if index already exists (42P07) or duplicate key (23505 during race condition)
      if (error.code === '42P07' || error.code === '23505') {
        console.log("[SEARCH_INIT] ✓ Trigram index already exists");
      } else {
        throw error;
      }
    }
    
    // Create search vector trigger and function
    try {
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
    } catch (error: any) {
      console.log("[SEARCH_INIT] ✓ Search vector function already exists");
    }
    
    // Create trigger if it doesn't exist
    try {
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
    } catch (error: any) {
      console.log("[SEARCH_INIT] ✓ Search vector trigger already exists");
    }
    
    console.log("[SEARCH_INIT] Search extensions initialized successfully");
  } catch (error) {
    // Log error but don't throw - allow server to start even if search init fails
    console.error("[SEARCH_INIT] Failed to initialize search extensions:", error);
    console.error("[SEARCH_INIT] Server will continue but search functionality may be degraded");
  }
}
