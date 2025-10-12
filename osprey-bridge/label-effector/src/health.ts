import http from 'http';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  kafka: {
    connected: boolean;
    messagesProcessed: number;
    lastMessageTime: Date | null;
  };
  database: {
    connected: boolean;
  };
  labels: {
    applied: number;
    negated: number;
    total: number;
  };
  uptime: number;
  timestamp: string;
}

export class HealthServer {
  private server: http.Server;
  private startTime: Date;

  constructor(
    private port: number,
    private getStatus: () => HealthStatus
  ) {
    this.startTime = new Date();
    // NOTE: Health check endpoint intentionally uses HTTP (not HTTPS) because:
    // 1. It's an internal monitoring endpoint typically accessed from localhost/private network
    // 2. Health checks don't require encryption (no sensitive data transmitted)
    // 3. Load balancers and orchestrators (Kubernetes, Docker) expect simple HTTP endpoints
    // 4. Using HTTP avoids certificate management complexity for internal monitoring
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === '/health' || req.url === '/') {
      try {
        const status = this.getStatus();
        
        const httpStatus = status.status === 'healthy' ? 200 : 503;
        
        res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
      } catch (error) {
        console.error('[HEALTH] Error generating status:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    } else if (req.url === '/ready') {
      // Kubernetes-style readiness probe
      const status = this.getStatus();
      const httpStatus = status.kafka.connected && status.database.connected ? 200 : 503;
      res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: httpStatus === 200 }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  start(): void {
    this.server.listen(this.port, '0.0.0.0', () => {
      console.log(`[HEALTH] Health server listening on http://0.0.0.0:${this.port}`);
      console.log(`[HEALTH] Endpoints: /health, /ready`);
    });
  }

  stop(): void {
    this.server.close(() => {
      console.log('[HEALTH] Health server stopped');
    });
  }
}
