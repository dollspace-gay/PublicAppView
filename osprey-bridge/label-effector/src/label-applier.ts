import { Pool } from 'pg';
import type { OspreyLabel } from './kafka-consumer';

export class LabelApplier {
  private pool: Pool;
  private labelsApplied: number = 0;
  private labelsNegated: number = 0;
  private isConnected: boolean = false;
  private lastSuccessfulQuery: Date | null = null;

  constructor(
    private databaseUrl: string,
    private ospreyLabelerDid: string
  ) {
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      console.error('[DB] Unexpected database pool error:', err);
      this.isConnected = false;
    });

    this.pool.on('connect', () => {
      this.isConnected = true;
    });
  }

  async connect(): Promise<void> {
    console.log('[DB] Testing database connection...');
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT NOW()');
      console.log('[DB] Database connection successful:', result.rows[0].now);
      this.isConnected = true;
      this.lastSuccessfulQuery = new Date();
    } finally {
      client.release();
    }
  }

  isHealthy(): boolean {
    return this.isConnected && this.lastSuccessfulQuery !== null;
  }

  async applyLabel(label: OspreyLabel): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Parse created timestamp
      const createdAt = new Date(label.cts);
      
      // Check if this is a negation
      const isNegation = label.neg === true;
      
      if (isNegation) {
        console.log(`[LABEL] Negating label ${label.val} for ${label.uri}`);
        
        await client.query('BEGIN');
        
        try {
          // Find ALL existing positive labels for this (src, subject, val) tuple
          const existingLabels = await client.query(
            `SELECT uri FROM labels 
             WHERE src = $1 AND subject = $2 AND val = $3 AND neg = false`,
            [this.ospreyLabelerDid, label.uri, label.val]
          );

          if (existingLabels.rows.length > 0) {
            // Delete ALL matching labels
            const deleteResult = await client.query(
              `DELETE FROM labels 
               WHERE src = $1 AND subject = $2 AND val = $3 AND neg = false
               RETURNING uri`,
              [this.ospreyLabelerDid, label.uri, label.val]
            );

            // Create deletion events for each removed label
            for (const row of deleteResult.rows) {
              await client.query(
                `INSERT INTO label_events (label_uri, action, timestamp)
                 VALUES ($1, $2, NOW())`,
                [row.uri, 'deleted']
              );
            }

            const count = deleteResult.rows.length;
            console.log(`[LABEL] Removed ${count} existing label(s): ${label.val} → ${label.uri}`);
            this.labelsNegated += count;
          } else {
            console.log(`[LABEL] No existing labels to negate: ${label.val} → ${label.uri}`);
          }
          
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } else {
        console.log(`[LABEL] Applying label ${label.val} to ${label.uri}`);
        
        // Generate label URI (unique identifier)
        const labelUri = `at://${this.ospreyLabelerDid}/app.bsky.labeler.label/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Check if label already exists (prevent duplicates)
        const existing = await client.query(
          `SELECT uri FROM labels 
           WHERE src = $1 AND subject = $2 AND val = $3 AND neg = false
           LIMIT 1`,
          [this.ospreyLabelerDid, label.uri, label.val]
        );

        if (existing.rows.length > 0) {
          console.log(`[LABEL] Label already exists: ${label.val} → ${label.uri}`);
          return;
        }

        // Insert new label
        await client.query(
          `INSERT INTO labels (uri, src, subject, val, neg, created_at, indexed_at)
           VALUES ($1, $2, $3, $4, false, $5, NOW())`,
          [
            labelUri,
            this.ospreyLabelerDid, // Use Osprey labeler DID as source
            label.uri,             // Subject (post/account URI)
            label.val,             // Label value
            createdAt,             // Original creation time
          ]
        );

        // Create label event for real-time broadcasting
        await client.query(
          `INSERT INTO label_events (label_uri, action, timestamp)
           VALUES ($1, $2, NOW())`,
          [labelUri, 'created']
        );

        console.log(`[LABEL] Successfully applied label: ${label.val} → ${label.uri}`);
        this.labelsApplied++;
      }
      
      this.lastSuccessfulQuery = new Date();
      this.isConnected = true;
      
    } catch (error) {
      console.error('[LABEL] Error applying label:', error);
      console.error('[LABEL] Label data:', label);
      this.isConnected = false;
      throw error;
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    console.log('[DB] Closing database pool...');
    await this.pool.end();
    console.log('[DB] Database pool closed');
  }

  getMetrics() {
    return {
      applied: this.labelsApplied,
      negated: this.labelsNegated,
      total: this.labelsApplied + this.labelsNegated,
    };
  }
}
