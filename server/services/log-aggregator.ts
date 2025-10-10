/**
 * Log Aggregator Service
 * 
 * Reduces log spam by aggregating similar log messages and only outputting
 * them periodically with counts and summaries.
 */

interface AggregatedLog {
  key: string;
  message: string;
  level: 'log' | 'warn' | 'error';
  count: number;
  firstSeen: number;
  lastSeen: number;
  metadata?: Record<string, any>;
}

interface LogAggregatorConfig {
  flushInterval: number; // milliseconds
  maxAggregatedLogs: number;
  enableAggregation: boolean;
}

export class LogAggregator {
  private aggregatedLogs = new Map<string, AggregatedLog>();
  private flushTimer: NodeJS.Timeout | null = null;
  private config: LogAggregatorConfig;

  constructor(config: Partial<LogAggregatorConfig> = {}) {
    this.config = {
      flushInterval: config.flushInterval || 10000, // 10 seconds default
      maxAggregatedLogs: config.maxAggregatedLogs || 1000,
      enableAggregation: config.enableAggregation !== false,
    };

    if (this.config.enableAggregation) {
      this.startFlushTimer();
    }
  }

  private startFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flushAggregatedLogs();
    }, this.config.flushInterval);
  }

  private createLogKey(message: string, level: string, metadata?: Record<string, any>): string {
    // Create a key that groups similar log messages together
    // Remove dynamic parts like DIDs, URIs, and timestamps
    let key = message
      .replace(/did:[a-zA-Z0-9:.-]+/g, 'DID')
      .replace(/at:\/\/[a-zA-Z0-9:.-]+\/[a-zA-Z0-9.-]+/g, 'URI')
      .replace(/\d+/g, 'N') // Replace numbers with N
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Add metadata signature if present
    if (metadata && Object.keys(metadata).length > 0) {
      const metaKeys = Object.keys(metadata).sort();
      key += `|${metaKeys.join(',')}`;
    }

    return `${level}:${key}`;
  }

  log(message: string, metadata?: Record<string, any>) {
    if (!this.config.enableAggregation) {
      console.log(message);
      return;
    }

    const key = this.createLogKey(message, 'log', metadata);
    const now = Date.now();

    if (this.aggregatedLogs.has(key)) {
      const existing = this.aggregatedLogs.get(key)!;
      existing.count++;
      existing.lastSeen = now;
    } else {
      // Check if we're at capacity
      if (this.aggregatedLogs.size >= this.config.maxAggregatedLogs) {
        // Remove oldest entry
        const oldestKey = Array.from(this.aggregatedLogs.entries())
          .sort(([,a], [,b]) => a.firstSeen - b.firstSeen)[0][0];
        this.aggregatedLogs.delete(oldestKey);
      }

      this.aggregatedLogs.set(key, {
        key,
        message,
        level: 'log',
        count: 1,
        firstSeen: now,
        lastSeen: now,
        metadata,
      });
    }
  }

  warn(message: string, metadata?: Record<string, any>) {
    if (!this.config.enableAggregation) {
      console.warn(message);
      return;
    }

    const key = this.createLogKey(message, 'warn', metadata);
    const now = Date.now();

    if (this.aggregatedLogs.has(key)) {
      const existing = this.aggregatedLogs.get(key)!;
      existing.count++;
      existing.lastSeen = now;
    } else {
      if (this.aggregatedLogs.size >= this.config.maxAggregatedLogs) {
        const oldestKey = Array.from(this.aggregatedLogs.entries())
          .sort(([,a], [,b]) => a.firstSeen - b.firstSeen)[0][0];
        this.aggregatedLogs.delete(oldestKey);
      }

      this.aggregatedLogs.set(key, {
        key,
        message,
        level: 'warn',
        count: 1,
        firstSeen: now,
        lastSeen: now,
        metadata,
      });
    }
  }

  error(message: string, metadata?: Record<string, any>) {
    if (!this.config.enableAggregation) {
      console.error(message);
      return;
    }

    const key = this.createLogKey(message, 'error', metadata);
    const now = Date.now();

    if (this.aggregatedLogs.has(key)) {
      const existing = this.aggregatedLogs.get(key)!;
      existing.count++;
      existing.lastSeen = now;
    } else {
      if (this.aggregatedLogs.size >= this.config.maxAggregatedLogs) {
        const oldestKey = Array.from(this.aggregatedLogs.entries())
          .sort(([,a], [,b]) => a.firstSeen - b.firstSeen)[0][0];
        this.aggregatedLogs.delete(oldestKey);
      }

      this.aggregatedLogs.set(key, {
        key,
        message,
        level: 'error',
        count: 1,
        firstSeen: now,
        metadata,
      });
    }
  }

  private flushAggregatedLogs() {
    if (this.aggregatedLogs.size === 0) {
      return;
    }

    const logs = Array.from(this.aggregatedLogs.values());
    
    // Sort by count (descending) to show most frequent issues first
    logs.sort((a, b) => b.count - a.count);

    console.log(`\n[LOG_AGGREGATOR] Flushing ${logs.length} aggregated log entries:`);
    
    for (const log of logs) {
      const duration = Math.round((log.lastSeen - log.firstSeen) / 1000);
      const countText = log.count > 1 ? ` (${log.count}x over ${duration}s)` : '';
      
      const formattedMessage = log.message + countText;
      
      if (log.level === 'error') {
        console.error(`[AGGREGATED] ${formattedMessage}`);
      } else if (log.level === 'warn') {
        console.warn(`[AGGREGATED] ${formattedMessage}`);
      } else {
        console.log(`[AGGREGATED] ${formattedMessage}`);
      }
    }

    // Clear the aggregated logs
    this.aggregatedLogs.clear();
  }

  // Force immediate flush (useful for shutdown)
  flush() {
    this.flushAggregatedLogs();
  }

  // Get current aggregated logs (for debugging)
  getAggregatedLogs(): AggregatedLog[] {
    return Array.from(this.aggregatedLogs.values());
  }

  // Update configuration
  updateConfig(newConfig: Partial<LogAggregatorConfig>) {
    this.config = { ...this.config, ...newConfig };
    
    if (this.config.enableAggregation && !this.flushTimer) {
      this.startFlushTimer();
    } else if (!this.config.enableAggregation && this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // Cleanup
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushAggregatedLogs();
  }
}

// Create singleton instance
export const logAggregator = new LogAggregator({
  flushInterval: parseInt(process.env.LOG_AGGREGATION_INTERVAL || '10000'),
  maxAggregatedLogs: parseInt(process.env.LOG_AGGREGATION_MAX_LOGS || '1000'),
  enableAggregation: process.env.LOG_AGGREGATION_ENABLED !== 'false',
});

// Graceful shutdown
process.on('SIGINT', () => {
  logAggregator.destroy();
});

process.on('SIGTERM', () => {
  logAggregator.destroy();
});