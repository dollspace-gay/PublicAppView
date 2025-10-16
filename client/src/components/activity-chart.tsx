import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ActivityData {
  timestamp: number;
  commit: number;
  identity: number;
  account: number;
}

export function ActivityChart() {
  const [data, setData] = useState<ActivityData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/metrics/activity-history');
        if (response.ok) {
          const history = await response.json();
          setData(history);
        }
      } catch (error) {
        console.error('[ActivityChart] Failed to fetch activity history:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);

    return () => clearInterval(interval);
  }, []);

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  };

  // Custom tooltip with aurora styling
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const total = payload.reduce((sum: number, entry: any) => sum + entry.value, 0);

      return (
        <div className="bg-card/95 backdrop-blur-xl border border-border rounded-lg p-3 shadow-lg">
          <p className="text-xs text-muted-foreground mb-2 font-mono">
            {formatTime(label)}
          </p>
          <div className="space-y-1">
            {payload.map((entry: any) => (
              <div key={entry.name} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-xs text-foreground capitalize">
                    {entry.name}
                  </span>
                </div>
                <span className="text-xs font-mono font-semibold" style={{ color: entry.color }}>
                  {entry.value.toLocaleString()}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 pt-1 mt-1 border-t border-border/50">
              <span className="text-xs text-muted-foreground">Total</span>
              <span className="text-xs font-mono font-semibold text-foreground">
                {total.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Sample every Nth point to avoid overwhelming the chart
  const sampledData = data.filter((_, index) => index % 5 === 0);

  return (
    <Card className="border-border" data-testid="card-activity-chart">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg">24-Hour Activity Stream</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Real-time event distribution across all firehose streams
        </p>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-muted-foreground animate-pulse">
              Loading activity data...
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-muted-foreground">
              No activity data available yet
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart
              data={sampledData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                {/* Aurora gradient for commits (teal) */}
                <linearGradient id="colorCommit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00F5D4" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#00F5D4" stopOpacity={0.1} />
                </linearGradient>
                {/* Aurora gradient for identity (green) */}
                <linearGradient id="colorIdentity" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#9AEF82" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#9AEF82" stopOpacity={0.1} />
                </linearGradient>
                {/* Aurora gradient for account (purple) */}
                <linearGradient id="colorAccount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#B900F5" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#B900F5" stopOpacity={0.1} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(139, 148, 158, 0.1)"
                vertical={false}
              />

              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                stroke="rgba(139, 148, 158, 0.5)"
                style={{ fontSize: '11px', fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={false}
                minTickGap={50}
              />

              <YAxis
                stroke="rgba(139, 148, 158, 0.5)"
                style={{ fontSize: '11px', fontFamily: 'monospace' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => value.toLocaleString()}
              />

              <Tooltip content={<CustomTooltip />} />

              {/* Commit events (teal - bottom layer) */}
              <Area
                type="monotone"
                dataKey="commit"
                stackId="1"
                stroke="#00F5D4"
                strokeWidth={2}
                fill="url(#colorCommit)"
                name="commit"
              />

              {/* Identity events (green - middle layer) */}
              <Area
                type="monotone"
                dataKey="identity"
                stackId="1"
                stroke="#9AEF82"
                strokeWidth={2}
                fill="url(#colorIdentity)"
                name="identity"
              />

              {/* Account events (purple - top layer) */}
              <Area
                type="monotone"
                dataKey="account"
                stackId="1"
                stroke="#B900F5"
                strokeWidth={2}
                fill="url(#colorAccount)"
                name="account"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#00F5D4] shadow-sm"></div>
            <span className="text-xs text-muted-foreground font-mono">#commit</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#9AEF82] shadow-sm"></div>
            <span className="text-xs text-muted-foreground font-mono">#identity</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#B900F5] shadow-sm"></div>
            <span className="text-xs text-muted-foreground font-mono">#account</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
