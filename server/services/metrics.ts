import os from 'os';

interface EventCounts {
  '#commit': number;
  '#identity': number;
  '#account': number;
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
    '#commit': 0,
    '#identity': 0,
    '#account': 0,
  };
  private totalEvents = 0;
  private errorCount = 0;
  private firehoseStatus: 'connected' | 'disconnected' | 'error' =
    'disconnected';
  private lastUpdate = new Date();
  private startTime = new Date();

  private apiRequests: { timestamp: number }[] = [];
  private readonly API_REQUEST_WINDOW = 60000;

  private endpointMetrics: Map<string, EndpointMetrics> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  // CPU tracking for accurate measurements
  private previousCpuTimes: NodeJS.CpuUsage | null = null;
  private previousCpuTimestamp: number = Date.now();

  // Network tracking
  private networkBytesReceived = 0;
  private networkBytesSent = 0;
  private previousNetworkTime = Date.now();

  constructor() {
    // Periodic cleanup every 5 minutes to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    // Initialize CPU tracking
    this.previousCpuTimes = process.cpuUsage();
  }

  private cleanup() {
    const now = Date.now();
    const cutoff = now - this.API_REQUEST_WINDOW;

    // Clean up API requests
    this.apiRequests = this.apiRequests.filter((req) => req.timestamp > cutoff);

    // Clean up endpoint metrics
    this.endpointMetrics.forEach((metrics) => {
      metrics.requests = metrics.requests.filter(
        (req) => req.timestamp > cutoff
      );
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

  updateFirehoseStatus(status: 'connected' | 'disconnected' | 'error') {
    this.firehoseStatus = status;
  }

  recordApiRequest() {
    const now = Date.now();
    this.apiRequests.push({ timestamp: now });

    const cutoff = now - this.API_REQUEST_WINDOW;
    this.apiRequests = this.apiRequests.filter((req) => req.timestamp > cutoff);
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
    metrics.requests = metrics.requests.filter((req) => req.timestamp > cutoff);
  }

  getApiRequestsPerMinute(): number {
    const now = Date.now();
    const cutoff = now - this.API_REQUEST_WINDOW;
    const recentRequests = this.apiRequests.filter(
      (req) => req.timestamp > cutoff
    );
    return recentRequests.length;
  }

  getEndpointMetrics(path?: string) {
    if (path) {
      const metrics = this.endpointMetrics.get(path);
      if (!metrics) return null;

      const now = Date.now();
      const cutoff = now - this.API_REQUEST_WINDOW;
      const recentRequests = metrics.requests.filter(
        (req) => req.timestamp > cutoff
      );

      return {
        path: metrics.path,
        totalRequests: metrics.totalRequests,
        requestsPerMinute: recentRequests.length,
        avgResponseTime:
          metrics.totalRequests > 0
            ? Math.round(metrics.totalResponseTime / metrics.totalRequests)
            : 0,
        successRate:
          metrics.totalRequests > 0
            ? (metrics.successCount / metrics.totalRequests) * 100
            : 0,
      };
    }

    const result: Record<string, any> = {};
    this.endpointMetrics.forEach((metrics, path) => {
      const now = Date.now();
      const cutoff = now - this.API_REQUEST_WINDOW;
      const recentRequests = metrics.requests.filter(
        (req) => req.timestamp > cutoff
      );

      result[path] = {
        path: metrics.path,
        totalRequests: metrics.totalRequests,
        requestsPerMinute: recentRequests.length,
        avgResponseTime:
          metrics.totalRequests > 0
            ? Math.round(metrics.totalResponseTime / metrics.totalRequests)
            : 0,
        successRate:
          metrics.totalRequests > 0
            ? (metrics.successCount / metrics.totalRequests) * 100
            : 0,
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
      errorRate:
        this.totalEvents > 0 ? (this.errorCount / this.totalEvents) * 100 : 0,
      firehoseStatus: this.firehoseStatus,
      lastUpdate: this.lastUpdate,
      uptime: Date.now() - this.startTime.getTime(),
      apiRequestsPerMinute: this.getApiRequestsPerMinute(),
    };
  }

  trackNetworkBytes(received: number, sent: number) {
    this.networkBytesReceived += received;
    this.networkBytesSent += sent;
  }

  async getSystemHealth(): Promise<SystemHealth> {
    // CPU calculation using process.cpuUsage() for accurate measurements
    const currentCpuUsage = process.cpuUsage(
      this.previousCpuTimes || undefined
    );
    const currentTime = Date.now();
    const timeDiff = currentTime - this.previousCpuTimestamp;

    // Calculate CPU percentage: (user + system time in microseconds) / (elapsed time in microseconds)
    // Convert timeDiff from ms to microseconds (*1000)
    const cpuPercent =
      ((currentCpuUsage.user + currentCpuUsage.system) / (timeDiff * 1000)) *
      100;
    const cpu = Math.min(100, Math.max(0, Math.round(cpuPercent)));

    // Update previous values for next calculation
    this.previousCpuTimes = process.cpuUsage();
    this.previousCpuTimestamp = currentTime;

    // Memory calculation (accurate)
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memory = Math.round(((totalMem - freeMem) / totalMem) * 100);

    // Process memory as disk proxy (since true disk usage requires external deps)
    const processMemUsage = process.memoryUsage();
    const processMemMB = Math.round(processMemUsage.heapUsed / 1024 / 1024);
    const totalMemMB = Math.round(totalMem / 1024 / 1024);
    const disk = Math.min(
      100,
      Math.round((processMemMB / totalMemMB) * 100 * 10)
    ); // Scale up for visibility

    // Network throughput (bytes/sec)
    const networkTimeDiff = (currentTime - this.previousNetworkTime) / 1000; // seconds
    const receivedRate =
      networkTimeDiff > 0
        ? Math.round(this.networkBytesReceived / networkTimeDiff / 1024)
        : 0; // KB/s
    const sentRate =
      networkTimeDiff > 0
        ? Math.round(this.networkBytesSent / networkTimeDiff / 1024)
        : 0; // KB/s

    // Format network string
    const network = `↓ ${receivedRate} KB/s ↑ ${sentRate} KB/s`;

    // Reset network counters
    this.networkBytesReceived = 0;
    this.networkBytesSent = 0;
    this.previousNetworkTime = currentTime;

    return {
      cpu,
      memory,
      disk,
      network,
    };
  }

  reset() {
    this.eventCounts = { '#commit': 0, '#identity': 0, '#account': 0 };
    this.totalEvents = 0;
    this.errorCount = 0;
  }
}

export const metricsService = new MetricsService();
