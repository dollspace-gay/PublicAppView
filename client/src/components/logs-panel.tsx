import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Loader2 } from "lucide-react";

interface LogEntry {
  timestamp: string;
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "EVENT";
  message: string;
  metadata?: Record<string, any>;
}

const getLevelColor = (level: LogEntry["level"]) => {
  switch (level) {
    case "INFO": return "text-primary";
    case "SUCCESS": return "text-success";
    case "WARNING": return "text-warning";
    case "ERROR": return "text-destructive";
    case "EVENT": return "text-accent";
    default: return "text-foreground";
  }
};

export function LogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch("/api/logs?limit=100");
        if (response.ok) {
          const data = await response.json();
          setLogs(data);
        }
      } catch (error) {
        console.error("Failed to fetch logs:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, []);

  const handleClearLogs = async () => {
    try {
      const response = await fetch("/api/logs/clear", { method: "POST" });
      if (response.ok) {
        setLogs([]);
      }
    } catch (error) {
      console.error("Failed to clear logs:", error);
    }
  };

  const handleDownloadLogs = () => {
    const logText = logs
      .map(log => {
        const timestamp = new Date(log.timestamp).toLocaleString();
        return `[${timestamp}][${log.level}] ${log.message}`;
      })
      .join("\n");
    
    const blob = new Blob([logText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `appview-logs-${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredLogs = filter === "all" 
    ? logs 
    : logs.filter(log => log.level.toLowerCase() === filter);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  return (
    <Card className="border-border" data-testid="card-logs">
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Button 
              variant={filter === "all" ? "default" : "outline"} 
              size="sm" 
              data-testid="button-filter-all"
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            <Button 
              variant={filter === "info" ? "default" : "outline"} 
              size="sm" 
              data-testid="button-filter-info"
              onClick={() => setFilter("info")}
            >
              Info
            </Button>
            <Button 
              variant={filter === "warning" ? "default" : "outline"} 
              size="sm" 
              data-testid="button-filter-warning"
              onClick={() => setFilter("warning")}
            >
              Warning
            </Button>
            <Button 
              variant={filter === "error" ? "default" : "outline"} 
              size="sm" 
              data-testid="button-filter-error"
              onClick={() => setFilter("error")}
            >
              Error
            </Button>
          </div>
          <div className="flex items-center space-x-2">
            <Button 
              variant="outline" 
              size="sm" 
              data-testid="button-download-logs"
              onClick={handleDownloadLogs}
              disabled={logs.length === 0}
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              data-testid="button-clear-logs"
              onClick={handleClearLogs}
              disabled={logs.length === 0}
            >
              Clear Logs
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <ScrollArea className="h-96">
          <div className="bg-background rounded-lg border border-border p-4 font-mono text-sm">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {logs.length === 0 ? "No logs yet. Waiting for application events..." : `No ${filter} logs found.`}
              </p>
            ) : (
              filteredLogs.map((log, i) => (
                <div key={i} className="mb-2" data-testid={`log-entry-${i}`}>
                  <span className="text-muted-foreground">[{formatTime(log.timestamp)}]</span>
                  <span className={`ml-2 ${getLevelColor(log.level)}`}>[{log.level}]</span>
                  <span className="text-foreground ml-2">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
