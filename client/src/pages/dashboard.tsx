import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { MetricsCards } from "@/components/metrics-cards";
import { SystemHealth } from "@/components/system-health";
import { FirehoseStatus } from "@/components/firehose-status";
import { OspreyStatus } from "@/components/osprey-status";
import { EventStream } from "@/components/event-stream";
import { DatabaseSchema } from "@/components/database-schema";
import { ApiEndpoints } from "@/components/api-endpoints";
import { LexiconValidatorPanel } from "@/components/lexicon-validator-panel";
import { LogsPanel } from "@/components/logs-panel";
import InstancePolicyPage from "@/pages/instance-policy";
import AdminControlPanel from "@/pages/admin-moderation";
import UserPanel from "@/pages/user-panel";
import LoginPage from "@/pages/login";
import { useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { api, setAuthToken } from "@/lib/api";

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
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const search = useSearch();

  // Handle auth token from URL (SECURITY: minimize token exposure in URL)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token");

    if (token) {
      console.log("[AUTH] Token found in URL, setting auth token...");
      
      // CRITICAL: Clear the URL IMMEDIATELY before any async operations
      // This minimizes the window where the token is visible in browser history
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Store token and invalidate session after URL is cleared
      setAuthToken(token);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
    }
  }, [search, queryClient]);

  const { data: session } = useQuery<{ isAdmin?: boolean }>({
    queryKey: ["/api/auth/session"],
    queryFn: () => api.get("/api/auth/session"),
    retry: false,
  });
  
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

  // Initial metrics fetch (SSE stream will update in real-time after connection)
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const data = await api.get<MetricsData>("/api/metrics");
        setMetrics(data);
      } catch (error) {
        console.error("Failed to fetch metrics:", error);
      }
    };

    fetchMetrics(); // Initial fetch only
  }, []);

  // Real-time event stream via Server-Sent Events (SSE)
  useEffect(() => {
    const recentEvents: any[] = [];
    let eventSource: EventSource | null = null;

    // Fetch initial events from API
    const fetchInitialEvents = async () => {
      try {
        const data = await api.get<any[]>("/api/events/recent");
        recentEvents.push(...data);
        setEvents([...data.slice(0, 10)]);
      } catch (error) {
        console.error("[Dashboard] Failed to fetch initial events:", error);
      }
    };

    // Start with initial fetch
    fetchInitialEvents();

    // Connect to SSE stream
    try {
      eventSource = new EventSource("/api/events/stream");

      eventSource.onopen = () => {
        console.log("[Dashboard] SSE stream connected");
      };

      eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === "event" && message.data) {
            // Add new event to the front
            recentEvents.unshift(message.data);
            // Keep only last 50 events
            if (recentEvents.length > 50) {
              recentEvents.pop();
            }
            // Update UI with latest 10
            setEvents([...recentEvents.slice(0, 10)]);
          } else if (message.type === "metrics") {
            // Update metrics from SSE stream
            setMetrics(message.data);
          } else if (message.type === "connected") {
            console.log("[Dashboard] SSE stream connected");
          }
        } catch (error) {
          console.error("[Dashboard] SSE message error:", error);
        }
      };

      eventSource.onerror = (error) => {
        console.error("[Dashboard] SSE error - reconnecting automatically...", error);
        // Don't close - let browser handle automatic reconnection
      };
    } catch (error) {
      console.error("[Dashboard] SSE creation failed:", error);
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, []);

  const handleReconnect = async () => {
    try {
      await api.post("/api/firehose/reconnect", {});
    } catch (error) {
      console.error("Failed to reconnect:", error);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 overflow-y-auto">
        <header className="bg-card/95 backdrop-blur-xl border-b border-border sticky top-0 z-10 shadow-sm h-[73px]">
          <div className="px-8 h-full flex items-center justify-between">
            <div className="flex items-center">
              <h2 className="text-2xl font-bold text-foreground">App View Dashboard</h2>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 px-4 py-2 bg-muted/50 rounded-lg border border-border/50 backdrop-blur-sm">
                <div className={`w-2 h-2 rounded-full ${metrics.firehoseStatus.connected ? "bg-success animate-pulse shadow-sm" : "bg-destructive"}`} />
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <OspreyStatus />
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

        {location === "/policy" && (
          <InstancePolicyPage />
        )}

        {location === "/login" && (
          <LoginPage />
        )}

        {location === "/admin/moderation" && (
          session?.isAdmin ? (
            <AdminControlPanel />
          ) : (
            <section className="p-8">
              <Card className="border-destructive/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <ShieldAlert className="h-6 w-6" />
                    Access Denied
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    You do not have permission to access the Admin Control Panel. 
                    This area is restricted to authorized administrators only.
                  </p>
                  <p className="text-muted-foreground mt-4">
                    If you believe you should have access, please contact your instance administrator.
                  </p>
                </CardContent>
              </Card>
            </section>
          )
        )}

        {location === "/user/panel" && (
          <UserPanel />
        )}
      </main>
    </div>
  );
}
