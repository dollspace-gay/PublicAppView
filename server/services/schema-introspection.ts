import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

const databaseUrl = process.env.DATABASE_URL!;

// Configure WebSocket for Neon (required for serverless)
neonConfig.webSocketConstructor = ws;

// Create a dedicated pool for schema introspection (avoids Drizzle execute() issues with Neon)
const schemaPool = new Pool({ connectionString: databaseUrl, max: 1 });

export interface TableField {
  name: string;
  type: string;
  description: string;
}

export interface TableSchema {
  name: string;
  description: string;
  rows: string;
  color: string;
  fields: TableField[];
  indexes: string[];
}

// Curated table descriptions mapping
const tableDescriptions: Record<string, string> = {
  users: "Profile and identity data",
  posts: "Feed posts and content",
  likes: "Post like interactions",
  reposts: "Post repost/retweet interactions",
  follows: "Social graph relationships",
  blocks: "User block relationships",
  mutes: "User mute relationships (soft blocks)",
  list_mutes: "Muted list relationships",
  list_blocks: "Blocked list relationships",
  thread_mutes: "Muted thread relationships",
  feed_generators: "Custom feed algorithm definitions",
  starter_packs: "Starter pack configurations",
  labeler_services: "Content labeling services",
  push_subscriptions: "Push notification subscriptions",
  video_jobs: "Video processing job status",
  firehose_cursor: "Firehose position tracking",
  lists: "User-created lists",
  list_items: "List item memberships",
  sessions: "User authentication sessions",
  user_preferences: "User preference settings",
  reports: "Content moderation reports",
};

// Field description mapping for common patterns
const fieldDescriptions: Record<string, string> = {
  did: "Decentralized identifier (DID)",
  uri: "AT Protocol URI",
  cid: "Content identifier (CID)",
  handle: "User handle/username",
  display_name: "Display name",
  avatar_url: "Avatar image URL",
  description: "Description text",
  created_at: "Creation timestamp",
  indexed_at: "Indexing timestamp",
  author_did: "Author's DID",
  user_did: "User's DID",
  follower_did: "Follower's DID",
  following_did: "Following user's DID",
  blocker_did: "Blocking user's DID",
  blocked_did: "Blocked user's DID",
  muter_did: "Muting user's DID",
  muted_did: "Muted user's DID",
  post_uri: "Post URI reference",
  parent_uri: "Parent post URI",
  root_uri: "Thread root URI",
  text: "Text content",
  embed: "Embedded media/content",
  cursor: "Firehose cursor position",
  last_saved_at: "Last save timestamp",
};

interface CacheEntry {
  data: TableSchema[];
  timestamp: number;
}

class SchemaIntrospectionService {
  private cache: CacheEntry | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private getColorForTable(tableName: string): string {
    // Stable color assignment based on table name hash
    const colors = ["primary", "accent", "success", "warning", "info", "destructive"];
    const hash = tableName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }

  private getFieldDescription(columnName: string, tableName: string): string {
    // Try exact match first
    const key = `${tableName}.${columnName}`;
    if (fieldDescriptions[key]) return fieldDescriptions[key];
    
    // Try pattern match
    if (fieldDescriptions[columnName]) return fieldDescriptions[columnName];
    
    // Generate from column name
    return columnName.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  private formatPostgresType(dataType: string, charMaxLength: number | null, udtName: string | null): string {
    // Map PostgreSQL types to readable format
    if (dataType === 'character varying') {
      return charMaxLength ? `VARCHAR(${charMaxLength})` : 'VARCHAR';
    }
    if (dataType === 'timestamp without time zone') return 'TIMESTAMP';
    if (dataType === 'timestamp with time zone') return 'TIMESTAMPTZ';
    if (dataType === 'jsonb') return 'JSONB';
    if (dataType === 'json') return 'JSON';
    if (dataType === 'text') return 'TEXT';
    if (dataType === 'integer') return 'INTEGER';
    if (dataType === 'bigint') return 'BIGINT';
    if (dataType === 'boolean') return 'BOOLEAN';
    if (dataType === 'ARRAY') {
      const baseType = udtName?.replace('_', '').toUpperCase() || 'UNKNOWN';
      return `${baseType}[]`;
    }
    if (dataType === 'USER-DEFINED' && udtName === 'tsvector') return 'TSVECTOR';
    
    return dataType.toUpperCase();
  }

  async getSchema(forceRefresh = false): Promise<TableSchema[]> {
    // Check cache
    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      return this.cache.data;
    }
    
    try {
      // Get all tables in the public schema
      const tablesResult = await schemaPool.query(`
        SELECT 
          t.table_name,
          COALESCE(pg_stat.n_live_tup, 0) as row_estimate,
          obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass) as table_comment
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables pg_stat 
          ON pg_stat.relname = t.table_name AND pg_stat.schemaname = t.table_schema
        WHERE t.table_schema = 'public' 
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name
      `);

      const schemas: TableSchema[] = [];

      for (const tableRow of tablesResult.rows) {
        const tableName = tableRow.table_name;
        
        // Get columns
        const columnsResult = await schemaPool.query(`
          SELECT 
            c.column_name,
            c.data_type,
            c.character_maximum_length,
            c.udt_name,
            c.is_nullable,
            c.column_default,
            col_description((quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass, c.ordinal_position) as column_comment
          FROM information_schema.columns c
          WHERE c.table_schema = 'public' 
            AND c.table_name = $1
          ORDER BY c.ordinal_position
        `, [tableName]);

        const fields: TableField[] = columnsResult.rows.map((col: any) => ({
          name: col.column_name,
          type: this.formatPostgresType(col.data_type, col.character_maximum_length, col.udt_name),
          description: col.column_comment || this.getFieldDescription(col.column_name, tableName),
        }));

        // Get indexes
        const indexesResult = await schemaPool.query(`
          SELECT 
            i.indexname,
            i.indexdef,
            ix.indisunique,
            am.amname as index_type
          FROM pg_indexes i
          LEFT JOIN pg_class c ON c.relname = i.indexname
          LEFT JOIN pg_index ix ON ix.indexrelid = c.oid
          LEFT JOIN pg_am am ON am.oid = c.relam
          WHERE i.schemaname = 'public' 
            AND i.tablename = $1
            AND i.indexname NOT LIKE '%_pkey'
          ORDER BY i.indexname
        `, [tableName]);

        const indexes: string[] = indexesResult.rows.map((idx: any) => {
          let indexName = idx.indexname;
          const isUnique = idx.indisunique;
          const indexType = idx.index_type;
          
          // Add type annotation for special index types
          if (indexType === 'gin') {
            indexName += ' (GIN)';
          } else if (indexType === 'gist') {
            indexName += ' (GiST)';
          } else if (indexType === 'hash') {
            indexName += ' (Hash)';
          }
          
          if (isUnique && !indexName.includes('unique')) {
            indexName += ' (Unique)';
          }
          
          return indexName;
        });

        // Get row count estimate (fast)
        const rowEstimate = Number(tableRow.row_estimate) || 0;
        
        schemas.push({
          name: tableName,
          description: (tableRow.table_comment as string) || tableDescriptions[tableName] || `${tableName} table`,
          rows: rowEstimate.toLocaleString(),
          color: this.getColorForTable(tableName),
          fields,
          indexes: indexes.length > 0 ? indexes : ['No indexes'],
        });
      }

      // Update cache
      this.cache = {
        data: schemas,
        timestamp: Date.now(),
      };

      return schemas;
    } catch (error) {
      console.error('[SCHEMA] Failed to introspect database schema:', error);
      throw error;
    }
  }

  clearCache(): void {
    this.cache = null;
  }
}

export const schemaIntrospectionService = new SchemaIntrospectionService();
