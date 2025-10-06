export interface LogEntry {
  timestamp: string;
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "EVENT";
  message: string;
  metadata?: Record<string, any>;
}

class LogCollector {
  private logs: LogEntry[] = [];
  private maxLogs = 500;

  log(level: LogEntry["level"], message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    };

    this.logs.unshift(entry); // Add to beginning
    
    if (this.logs.length > this.maxLogs) {
      this.logs.pop(); // Remove oldest
    }

    // ALWAYS output to stdout/stderr for production logging (captured by systemd/pm2/docker)
    const logLine = this.formatLogEntry(entry);
    
    if (level === "ERROR") {
      console.error(logLine);
    } else if (level === "WARNING") {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }
  }

  private formatLogEntry(entry: LogEntry): string {
    const prefix = `[${entry.timestamp}] [${entry.level}]`;
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      return `${prefix} ${entry.message} ${JSON.stringify(entry.metadata)}`;
    }
    return `${prefix} ${entry.message}`;
  }

  info(message: string, metadata?: Record<string, any>) {
    this.log("INFO", message, metadata);
  }

  success(message: string, metadata?: Record<string, any>) {
    this.log("SUCCESS", message, metadata);
  }

  warning(message: string, metadata?: Record<string, any>) {
    this.log("WARNING", message, metadata);
  }

  error(message: string, metadata?: Record<string, any>) {
    this.log("ERROR", message, metadata);
  }

  event(message: string, metadata?: Record<string, any>) {
    this.log("EVENT", message, metadata);
  }

  getRecentLogs(limit: number = 100): LogEntry[] {
    return this.logs.slice(0, limit);
  }

  clear() {
    this.logs = [];
  }
}

export const logCollector = new LogCollector();
