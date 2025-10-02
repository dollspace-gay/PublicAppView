import os from "os";

interface EventCounts {
  "#commit": number;
  "#identity": number;
  "#account": number;
}

interface SystemHealth {
  cpu: number;
  memory: number;
  disk: number;
  network: string;
}

interface EndpointMetrics {
  path: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  totalResponseTime: number;
  requests: Array<{ timestamp: number; duration: number; success: boolean }>;
}

export class MetricsService {
  private eventCounts: EventCounts = {
    "#commit": 0,
    "#identity": 0,
    "#account": 0,
  };
  private totalEvents = 0;
  private errorCount = 0;
  private firehoseStatus: "connected" | "disconnected" | "error" = "disconnected";
  private lastUpdate = new Date();
  private startTime = new Date();
  
  private apiRequests: { timestamp: number }[] = [];
  private readonly API_REQUEST_WINDOW = 60000;
  
  private endpointMetrics: Map<string, EndpointMetrics> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Periodic cleanup every 5 minutes to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    const cutoff = now - this.API_REQUEST_WINDOW;
    
    // Clean up API requests
    this.apiRequests = this.apiRequests.filter(req => req.timestamp > cutoff);
    
    // Clean up endpoint metrics
    this.endpointMetrics.forEach((metrics) => {
      metrics.requests = metrics.requests.filter(req => req.timestamp > cutoff);
    });
  }

  incrementEvent(type: keyof EventCounts) {
    this.eventCounts[type]++;
    this.totalEvents++;
    this.lastUpdate = new Date();
  }

  incrementError() {
    this.errorCount++;
  }

  updateFirehoseStatus(status: "connected" | "disconnected" | "error") {
    this.firehoseStatus = status;
  }

  recordApiRequest() {
    const now = Date.now();
    this.apiRequests.push({ timestamp: now });
    
    const cutoff = now - this.API_REQUEST_WINDOW;
    this.apiRequests = this.apiRequests.filter(req => req.timestamp > cutoff);
  }

  recordEndpointRequest(path: string, duration: number, success: boolean) {
    if (!this.endpointMetrics.has(path)) {
      this.endpointMetrics.set(path, {
        path,
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        totalResponseTime: 0,
        requests: [],
      });
    }

    const metrics = this.endpointMetrics.get(path)!;
    metrics.totalRequests++;
    if (success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
    }
    metrics.totalResponseTime += duration;

    const now = Date.now();
    metrics.requests.push({ timestamp: now, duration, success });

    const cutoff = now - this.API_REQUEST_WINDOW;
    metrics.requests = metrics.requests.filter(req => req.timestamp > cutoff);
  }

  getApiRequestsPerMinute(): number {
    const now = Date.now();
    const cutoff = now - this.API_REQUEST_WINDOW;
    const recentRequests = this.apiRequests.filter(req => req.timestamp > cutoff);
    return recentRequests.length;
  }

  getEndpointMetrics(path?: string) {
    if (path) {
      const metrics = this.endpointMetrics.get(path);
      if (!metrics) return null;

      const now = Date.now();
      const cutoff = now - this.API_REQUEST_WINDOW;
      const recentRequests = metrics.requests.filter(req => req.timestamp > cutoff);

      return {
        path: metrics.path,
        totalRequests: metrics.totalRequests,
        requestsPerMinute: recentRequests.length,
        avgResponseTime: metrics.totalRequests > 0 ? Math.round(metrics.totalResponseTime / metrics.totalRequests) : 0,
        successRate: metrics.totalRequests > 0 ? (metrics.successCount / metrics.totalRequests) * 100 : 0,
      };
    }

    const result: Record<string, any> = {};
    this.endpointMetrics.forEach((metrics, path) => {
      const now = Date.now();
      const cutoff = now - this.API_REQUEST_WINDOW;
      const recentRequests = metrics.requests.filter(req => req.timestamp > cutoff);

      result[path] = {
        path: metrics.path,
        totalRequests: metrics.totalRequests,
        requestsPerMinute: recentRequests.length,
        avgResponseTime: metrics.totalRequests > 0 ? Math.round(metrics.totalResponseTime / metrics.totalRequests) : 0,
        successRate: metrics.totalRequests > 0 ? (metrics.successCount / metrics.totalRequests) * 100 : 0,
      };
    });

    return result;
  }

  getEventCounts() {
    return { ...this.eventCounts };
  }

  getStats() {
    return {
      totalEvents: this.totalEvents,
      errorCount: this.errorCount,
      errorRate: this.totalEvents > 0 ? (this.errorCount / this.totalEvents) * 100 : 0,
      firehoseStatus: this.firehoseStatus,
      lastUpdate: this.lastUpdate,
      uptime: Date.now() - this.startTime.getTime(),
      apiRequestsPerMinute: this.getApiRequestsPerMinute(),
    };
  }

  async getSystemHealth(): Promise<SystemHealth> {
    const cpus = os.cpus();
    const totalCpu = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b);
      const idle = cpu.times.idle;
      return acc + (1 - idle / total);
    }, 0);
    
    const cpu = Math.round((totalCpu / cpus.length) * 100);
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memory = Math.round(((totalMem - freeMem) / totalMem) * 100);

    return {
      cpu,
      memory,
      disk: 0,
      network: "N/A",
    };
  }

  reset() {
    this.eventCounts = { "#commit": 0, "#identity": 0, "#account": 0 };
    this.totalEvents = 0;
    this.errorCount = 0;
  }
}

export const metricsService = new MetricsService();
