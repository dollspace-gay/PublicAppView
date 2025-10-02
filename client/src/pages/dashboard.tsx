import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { MetricsCards } from "@/components/metrics-cards";
import { SystemHealth } from "@/components/system-health";
import { FirehoseStatus } from "@/components/firehose-status";
import { EventStream } from "@/components/event-stream";
import { DatabaseSchema } from "@/components/database-schema";
import { ApiEndpoints } from "@/components/api-endpoints";
import { LexiconValidatorPanel } from "@/components/lexicon-validator-panel";
import { LogsPanel } from "@/components/logs-panel";
import { useLocation } from "wouter";

interface MetricsData {
  eventsProcessed: number;
  dbRecords: number;
  apiRequestsPerMinute: number;
  stats: {
    totalUsers: number;
    totalPosts: number;
    totalLikes: number;
    totalReposts: number;
    totalFollows: number;
  };
  eventCounts: {
    "#commit": number;
    "#identity": number;
    "#account": number;
  };
  systemHealth: {
    cpu: number;
    memory: number;
    disk: number;
    network: string;
  };
  firehoseStatus: {
    connected: boolean;
  };
  errorRate: number;
  lastUpdate: string;
}

export default function Dashboard() {
  const [location] = useLocation();
  const [metrics, setMetrics] = useState<MetricsData>({
    eventsProcessed: 0,
    dbRecords: 0,
    apiRequestsPerMinute: 0,
    stats: { totalUsers: 0, totalPosts: 0, totalLikes: 0, totalReposts: 0, totalFollows: 0 },
    eventCounts: { "#commit": 0, "#identity": 0, "#account": 0 },
    systemHealth: { cpu: 0, memory: 0, disk: 0, network: "N/A" },
    firehoseStatus: { connected: false },
    errorRate: 0,
    lastUpdate: new Date().toISOString(),
  });

  const [events, setEvents] = useState<any[]>([]);

  // Poll for metrics via HTTP (WebSocket has compression issues with Replit proxy)
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch("/api/metrics");
        if (response.ok) {
          const data = await response.json();
          setMetrics(data);
        }
      } catch (error) {
        console.error("Failed to fetch metrics:", error);
      }
    };

    fetchMetrics(); // Initial fetch
    const interval = setInterval(fetchMetrics, 2000); // Poll every 2s
    return () => clearInterval(interval);
  }, []);

  // Poll for recent events
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch("/api/events/recent");
        if (response.ok) {
          const data = await response.json();
          setEvents(data);
        }
      } catch (error) {
        console.error("Failed to fetch events:", error);
      }
    };

    fetchEvents(); // Initial fetch
    const interval = setInterval(fetchEvents, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, []);

  const handleReconnect = async () => {
    try {
      await fetch("/api/firehose/reconnect", { method: "POST" });
    } catch (error) {
      console.error("Failed to reconnect:", error);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 overflow-y-auto">
        <header className="bg-card border-b border-border sticky top-0 z-10">
          <div className="px-8 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">App View Dashboard</h2>
              <p className="text-sm text-muted-foreground mt-1">Monitor and manage your AT Protocol App View service</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 px-4 py-2 bg-muted rounded-lg">
                <div className={`w-2 h-2 rounded-full ${metrics.firehoseStatus.connected ? "bg-success animate-pulse" : "bg-destructive"}`} />
                <span className="text-sm font-medium font-mono">
                  Relay: {metrics.firehoseStatus.connected ? "Connected" : "Disconnected"}
                </span>
              </div>
            </div>
          </div>
        </header>

        {location === "/" && (
          <section className="p-8">
            <MetricsCards 
              eventsProcessed={metrics.eventsProcessed}
              dbRecords={metrics.dbRecords}
              apiRequests={metrics.apiRequestsPerMinute}
              activeUsers={metrics.stats.totalUsers}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8 mb-8">
              <SystemHealth {...metrics.systemHealth} />
              <FirehoseStatus
                connected={metrics.firehoseStatus.connected}
                commits={metrics.eventCounts["#commit"]}
                identity={metrics.eventCounts["#identity"]}
                account={metrics.eventCounts["#account"]}
                errorRate={metrics.errorRate}
                onReconnect={handleReconnect}
              />
            </div>

            <EventStream events={events} />
          </section>
        )}

        {location === "/firehose" && (
          <section className="p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Firehose Monitor</h2>
              <p className="text-muted-foreground">Real-time AT Protocol relay event stream</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <FirehoseStatus
                connected={metrics.firehoseStatus.connected}
                commits={metrics.eventCounts["#commit"]}
                identity={metrics.eventCounts["#identity"]}
                account={metrics.eventCounts["#account"]}
                errorRate={metrics.errorRate}
                onReconnect={handleReconnect}
              />
              <div className="grid grid-cols-1 gap-4">
                <div className="bg-card border border-border rounded-lg p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Event Breakdown</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">#commit events</span>
                      <span className="text-sm font-mono text-success" data-testid="text-commit-count">
                        {metrics.eventCounts["#commit"].toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">#identity events</span>
                      <span className="text-sm font-mono text-primary" data-testid="text-identity-count">
                        {metrics.eventCounts["#identity"].toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">#account events</span>
                      <span className="text-sm font-mono text-accent" data-testid="text-account-count">
                        {metrics.eventCounts["#account"].toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-lg p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Processing Stats</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">Total Events</span>
                      <span className="text-sm font-mono" data-testid="text-total-events">
                        {metrics.eventsProcessed.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">Error Rate</span>
                      <span className="text-sm font-mono text-destructive" data-testid="text-error-rate">
                        {metrics.errorRate.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <EventStream events={events} />
          </section>
        )}

        {location === "/database" && (
          <section className="p-8 bg-muted/30">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Database Schema</h2>
              <p className="text-muted-foreground">PostgreSQL schema optimized for AT Protocol data indexing</p>
            </div>
            <DatabaseSchema />
          </section>
        )}

        {location === "/api" && (
          <section className="p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">XRPC API Endpoints</h2>
              <p className="text-muted-foreground">Bluesky-compatible API implementation</p>
            </div>
            <ApiEndpoints />
          </section>
        )}

        {location === "/lexicons" && (
          <section className="p-8 bg-muted/30">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Lexicon Validator</h2>
              <p className="text-muted-foreground">Real-time schema validation and supported Lexicons</p>
            </div>
            <LexiconValidatorPanel
              total={metrics.eventsProcessed}
              valid={Math.floor(metrics.eventsProcessed * (1 - metrics.errorRate / 100))}
              invalid={Math.floor(metrics.eventsProcessed * (metrics.errorRate / 100))}
              errorRate={metrics.errorRate}
            />
          </section>
        )}

        {location === "/logs" && (
          <section className="p-8 bg-muted/30">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">System Logs</h2>
              <p className="text-muted-foreground">Real-time application logs and error tracking</p>
            </div>
            <LogsPanel />
          </section>
        )}
      </main>
    </div>
  );
}
