import { Activity, Database, TrendingUp, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface MetricsCardsProps {
  eventsProcessed: number;
  dbRecords: number;
  apiRequests: number;
  activeUsers: number;
}

export function MetricsCards({
  eventsProcessed,
  dbRecords,
  apiRequests,
  activeUsers,
}: MetricsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card
        className="border-border hover:border-primary transition-colors"
        data-testid="card-events-processed"
      >
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Events Processed
            </h3>
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
          </div>
          <div className="space-y-1">
            <p
              className="text-3xl font-bold text-foreground font-mono"
              data-testid="text-events-processed"
            >
              {eventsProcessed.toLocaleString()}
            </p>
            <p className="text-xs text-success flex items-center">
              <TrendingUp className="h-3 w-3 mr-1" />
              Real-time from firehose
            </p>
          </div>
        </CardContent>
      </Card>

      <Card
        className="border-border hover:border-primary transition-colors"
        data-testid="card-db-records"
      >
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Database Records
            </h3>
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
              <Database className="h-5 w-5 text-accent" />
            </div>
          </div>
          <div className="space-y-1">
            <p
              className="text-3xl font-bold text-foreground font-mono"
              data-testid="text-db-records"
            >
              {dbRecords > 1000000
                ? `${(dbRecords / 1000000).toFixed(1)}M`
                : dbRecords.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">Across 6 tables</p>
          </div>
        </CardContent>
      </Card>

      <Card
        className="border-border hover:border-primary transition-colors"
        data-testid="card-api-requests"
      >
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              API Requests/Min
            </h3>
            <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
          </div>
          <div className="space-y-1">
            <p
              className="text-3xl font-bold text-foreground font-mono"
              data-testid="text-api-requests"
            >
              {apiRequests}
            </p>
            <p className="text-xs text-muted-foreground">Avg response: 42ms</p>
          </div>
        </CardContent>
      </Card>

      <Card
        className="border-border hover:border-primary transition-colors"
        data-testid="card-active-users"
      >
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Active Users
            </h3>
            <div className="w-10 h-10 bg-warning/10 rounded-lg flex items-center justify-center">
              <Users className="h-5 w-5 text-warning" />
            </div>
          </div>
          <div className="space-y-1">
            <p
              className="text-3xl font-bold text-foreground font-mono"
              data-testid="text-active-users"
            >
              {activeUsers.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">24h active</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
