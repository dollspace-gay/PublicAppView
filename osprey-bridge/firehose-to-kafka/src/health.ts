import express from 'express';
import http from 'http';

export interface BridgeStatus {
  running: boolean;
  kafka: {
    connected: boolean;
  };
  adapterType: string;
  eventsProcessed: number;
  enricher?: {
    database: boolean;
  };
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  adapter: {
    type: string;
    running: boolean;
  };
  kafka: {
    connected: boolean;
  };
  enricher: {
    database: boolean;
  };
  metrics: {
    eventsProcessed: number;
    uptime: number;
  };
  timestamp: string;
}

export class HealthCheckServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private port: number;
  private getStatus: () => BridgeStatus;
  private startTime: number;

  constructor(port: number, getStatus: () => BridgeStatus) {
    this.app = express();
    this.port = port;
    this.getStatus = getStatus;
    this.startTime = Date.now();
  }

  start(): void {
    this.app.get('/health', (req, res) => {
      try {
        const bridgeStatus = this.getStatus();
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);

        const health: HealthStatus = {
          status:
            bridgeStatus.running && bridgeStatus.kafka.connected
              ? 'healthy'
              : 'unhealthy',
          adapter: {
            type: bridgeStatus.adapterType,
            running: bridgeStatus.running,
          },
          kafka: {
            connected: bridgeStatus.kafka.connected,
          },
          enricher: {
            database: bridgeStatus.enricher?.database ?? true,
          },
          metrics: {
            eventsProcessed: bridgeStatus.eventsProcessed,
            uptime,
          },
          timestamp: new Date().toISOString(),
        };

        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: 'Failed to get health status',
          timestamp: new Date().toISOString(),
        });
      }
    });

    this.app.get('/ready', (req, res) => {
      try {
        const bridgeStatus = this.getStatus();
        if (bridgeStatus.running && bridgeStatus.kafka.connected) {
          res.status(200).json({ ready: true });
        } else {
          res
            .status(503)
            .json({ ready: false, timestamp: new Date().toISOString() });
        }
      } catch (error) {
        res.status(503).json({
          ready: false,
          error: 'Failed to get readiness status',
          timestamp: new Date().toISOString(),
        });
      }
    });

    this.server = this.app.listen(this.port, () => {
      console.log(
        `[HEALTH] Health check server listening on port ${this.port}`
      );
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
    }
  }
}
