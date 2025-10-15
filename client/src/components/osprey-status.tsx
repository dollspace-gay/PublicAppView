import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, Activity, Check, X, AlertCircle, Loader2 } from 'lucide-react';

interface OspreyStatusResponse {
  enabled: boolean;
  healthy?: boolean;
  bridge?: {
    healthy: boolean;
    adapter?: {
      type: string;
      running: boolean;
    };
    kafka?: {
      connected: boolean;
    };
    metrics?: {
      eventsProcessed: number;
      uptime: number;
    };
    error?: string;
  };
  effector?: {
    healthy: boolean;
    kafka?: {
      connected: boolean;
      messagesProcessed: number;
    };
    labels?: {
      applied: number;
      negated: number;
      total: number;
    };
    database?: {
      connected: boolean;
    };
    error?: string;
  };
  error?: string;
  message?: string;
  timestamp?: string;
}

export function OspreyStatus() {
  const { data, isLoading, isError, error, refetch } =
    useQuery<OspreyStatusResponse>({
      queryKey: ['/api/osprey/status'],
      refetchInterval: 10000, // Refresh every 10 seconds
      retry: 3,
    });

  if (isLoading) {
    return (
      <Card data-testid="card-osprey-status">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Osprey Integration</CardTitle>
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
          <CardDescription>
            Advanced moderation and spam detection
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Handle API request errors (network failures, timeouts, etc.)
  // OR backend-reported errors (enabled but bridge unhealthy)
  const hasError = isError || (data?.enabled && data?.error);

  if (hasError) {
    const errorMessage =
      data?.error ||
      (error instanceof Error ? error.message : 'Network request failed');
    const errorTitle = data?.error
      ? 'Osprey bridge is unhealthy'
      : 'Unable to reach Osprey status endpoint';

    return (
      <Card data-testid="card-osprey-status">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-destructive" />
              <CardTitle className="text-lg">Osprey Integration</CardTitle>
            </div>
            <Badge variant="destructive" data-testid="badge-osprey-error">
              Error
            </Badge>
          </div>
          <CardDescription>
            Advanced moderation and spam detection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            className="p-3 bg-destructive/10 rounded text-sm text-destructive"
            data-testid="text-status-error"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{errorTitle}</p>
                <p className="text-xs mt-1 opacity-90">{errorMessage}</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            className="w-full text-sm py-2 px-3 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition"
            data-testid="button-retry-status"
          >
            Retry Connection
          </button>
        </CardContent>
      </Card>
    );
  }

  if (!data?.enabled) {
    return (
      <Card data-testid="card-osprey-status">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Osprey Integration</CardTitle>
            </div>
            <Badge variant="secondary" data-testid="badge-osprey-disabled">
              Disabled
            </Badge>
          </div>
          <CardDescription>
            Advanced moderation and spam detection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Osprey is not currently enabled. To enable advanced moderation:
          </p>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
            <li>
              Clone Osprey into{' '}
              <code className="bg-muted px-1 rounded">osprey/</code> directory
            </li>
            <li>
              Run{' '}
              <code className="bg-muted px-1 rounded">
                ./scripts/enable-osprey.sh
              </code>
            </li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  const statusColor = data.healthy ? 'text-green-500' : 'text-red-500';
  const statusIcon = data.healthy ? Check : data.error ? X : AlertCircle;
  const StatusIcon = statusIcon;

  const bridgeHealthy = data.bridge?.healthy ?? false;
  const effectorHealthy = data.effector?.healthy ?? false;

  return (
    <Card data-testid="card-osprey-status">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Osprey Integration</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon
              className={`h-4 w-4 ${statusColor}`}
              data-testid="icon-osprey-health"
            />
            <Badge
              variant={data.healthy ? 'default' : 'destructive'}
              data-testid={`badge-osprey-${data.healthy ? 'healthy' : 'unhealthy'}`}
            >
              {data.healthy ? 'Healthy' : 'Unhealthy'}
            </Badge>
          </div>
        </div>
        <CardDescription>
          Real-time moderation pipeline with label application
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bridge Status */}
        {data.bridge && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Activity
                className={`h-4 w-4 ${bridgeHealthy ? 'text-green-500' : 'text-red-500'}`}
              />
              <span>Firehose Bridge</span>
              <Badge
                variant={bridgeHealthy ? 'outline' : 'destructive'}
                className="ml-auto"
              >
                {bridgeHealthy ? 'Running' : 'Error'}
              </Badge>
            </div>

            {data.bridge.adapter && (
              <div className="flex items-center justify-between text-sm pl-6">
                <span className="text-muted-foreground">Adapter:</span>
                <Badge variant="outline" data-testid="badge-bridge-adapter">
                  {data.bridge.adapter.type}
                </Badge>
              </div>
            )}

            {data.bridge.kafka && (
              <div className="flex items-center justify-between text-sm pl-6">
                <span className="text-muted-foreground">Kafka:</span>
                <Badge
                  variant={
                    data.bridge.kafka.connected ? 'outline' : 'destructive'
                  }
                >
                  {data.bridge.kafka.connected ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
            )}

            {data.bridge.metrics && (
              <div className="flex items-center justify-between text-sm pl-6">
                <span className="text-muted-foreground">Events Published:</span>
                <span className="font-mono" data-testid="text-bridge-events">
                  {data.bridge.metrics.eventsProcessed.toLocaleString()}
                </span>
              </div>
            )}

            {data.bridge.error && (
              <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {data.bridge.error}
              </div>
            )}
          </div>
        )}

        {/* Label Effector Status */}
        {data.effector && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Shield
                className={`h-4 w-4 ${effectorHealthy ? 'text-green-500' : 'text-red-500'}`}
              />
              <span>Label Effector</span>
              <Badge
                variant={effectorHealthy ? 'outline' : 'destructive'}
                className="ml-auto"
              >
                {effectorHealthy ? 'Running' : 'Error'}
              </Badge>
            </div>

            {data.effector.kafka && (
              <div className="flex items-center justify-between text-sm pl-6">
                <span className="text-muted-foreground">Kafka:</span>
                <Badge
                  variant={
                    data.effector.kafka.connected ? 'outline' : 'destructive'
                  }
                >
                  {data.effector.kafka.connected ? 'Connected' : 'Disconnected'}
                </Badge>
              </div>
            )}

            {data.effector.labels && (
              <>
                <div className="flex items-center justify-between text-sm pl-6">
                  <span className="text-muted-foreground">Labels Applied:</span>
                  <span
                    className="font-mono text-green-600"
                    data-testid="text-labels-applied"
                  >
                    {data.effector.labels.applied.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm pl-6">
                  <span className="text-muted-foreground">Labels Negated:</span>
                  <span
                    className="font-mono text-amber-600"
                    data-testid="text-labels-negated"
                  >
                    {data.effector.labels.negated.toLocaleString()}
                  </span>
                </div>
              </>
            )}

            {data.effector.error && (
              <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {data.effector.error}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
