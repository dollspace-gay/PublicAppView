import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface SystemHealthProps {
  cpu: number;
  memory: number;
  disk: number;
  network: string;
}

export function SystemHealth({
  cpu,
  memory,
  disk,
  network,
}: SystemHealthProps) {
  return (
    <Card className="border-border" data-testid="card-system-health">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg">System Health</CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              CPU Usage
            </span>
            <span
              className="text-sm font-semibold text-foreground font-mono"
              data-testid="text-cpu"
            >
              {cpu}%
            </span>
          </div>
          <Progress value={cpu} className="h-2" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Memory Usage
            </span>
            <span
              className="text-sm font-semibold text-foreground font-mono"
              data-testid="text-memory"
            >
              {memory}%
            </span>
          </div>
          <Progress value={memory} className="h-2" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Disk Usage
            </span>
            <span
              className="text-sm font-semibold text-foreground font-mono"
              data-testid="text-disk"
            >
              {disk}%
            </span>
          </div>
          <Progress value={disk} className="h-2" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              Network I/O
            </span>
            <span
              className="text-sm font-semibold text-foreground font-mono"
              data-testid="text-network"
            >
              {network}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
