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
