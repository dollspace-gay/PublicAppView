import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface EndpointPerformance {
  avgResponse: string;
  requestsMin: string;
  successRate: string;
  totalRequests: number;
}

interface Endpoint {
  method: string;
  path: string;
  fullPath: string;
  description: string;
  params: string[];
  performance: EndpointPerformance;
  status: string;
}

export function ApiEndpoints() {
  const {
    data: endpoints,
    isLoading,
    error,
    isError,
  } = useQuery<Endpoint[]>({
    queryKey: ['/api/endpoints'],
  });

  console.log('[ApiEndpoints] Query state:', {
    isLoading,
    isError,
    hasData: !!endpoints,
    endpointsLength: endpoints?.length,
    error,
  });

  if (isLoading) {
    return (
      <Card className="border-border" data-testid="card-api-endpoints">
        <CardContent className="p-6">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="border border-border rounded-lg overflow-hidden"
              >
                <div className="px-6 py-4 bg-muted/30">
                  <Skeleton className="h-6 w-3/4" />
                </div>
                <div className="px-6 py-4 space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!endpoints || endpoints.length === 0) {
    return (
      <Card className="border-border" data-testid="card-api-endpoints">
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground">
            No API endpoints found
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border" data-testid="card-api-endpoints">
      <CardContent className="p-6">
        <div className="space-y-4">
          {endpoints.map((endpoint, i) => (
            <div
              key={i}
              className="border border-border rounded-lg overflow-hidden"
              data-testid={`endpoint-${endpoint.path}`}
            >
              <div className="px-6 py-4 bg-muted/30 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Badge
                    className="bg-success text-success-foreground font-mono"
                    data-testid={`badge-method-${i}`}
                  >
                    {endpoint.method}
                  </Badge>
                  <span
                    className="text-sm font-semibold font-mono text-foreground"
                    data-testid={`text-path-${i}`}
                  >
                    {endpoint.path}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={
                    endpoint.status === 'active'
                      ? 'bg-success/10 text-success'
                      : 'bg-muted text-muted-foreground'
                  }
                  data-testid={`badge-status-${i}`}
                >
                  {endpoint.status === 'active' ? 'Active' : 'Available'}
                </Badge>
              </div>
              <div className="px-6 py-4 space-y-3">
                <p
                  className="text-sm text-muted-foreground"
                  data-testid={`text-description-${i}`}
                >
                  {endpoint.description}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Parameters
                    </p>
                    <div className="space-y-1">
                      {endpoint.params.map((param, j) => (
                        <p
                          key={j}
                          className="text-xs font-mono text-foreground"
                          data-testid={`text-param-${i}-${j}`}
                        >
                          • {param}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      Performance
                    </p>
                    <div className="space-y-1">
                      <p className="text-xs text-foreground">
                        Avg Response:{' '}
                        <span
                          className="font-mono text-success"
                          data-testid={`text-avg-response-${i}`}
                        >
                          {endpoint.performance.avgResponse}
                        </span>
                      </p>
                      <p className="text-xs text-foreground">
                        Requests/min:{' '}
                        <span
                          className="font-mono"
                          data-testid={`text-requests-min-${i}`}
                        >
                          {endpoint.performance.requestsMin}
                        </span>
                      </p>
                      <p className="text-xs text-foreground">
                        Success Rate:{' '}
                        <span
                          className="font-mono text-success"
                          data-testid={`text-success-rate-${i}`}
                        >
                          {endpoint.performance.successRate}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
