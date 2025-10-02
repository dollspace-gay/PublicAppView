import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";

interface FirehoseStatusProps {
  connected: boolean;
  commits: number;
  identity: number;
  account: number;
  errorRate: number;
  onReconnect: () => void;
}

export function FirehoseStatus({ connected, commits, identity, account, errorRate, onReconnect }: FirehoseStatusProps) {
  return (
    <Card className="border-border" data-testid="card-firehose-status">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg">Firehose Status</CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div className="flex items-center space-x-3">
            {connected ? (
              <div className="w-3 h-3 bg-success rounded-full animate-pulse" />
            ) : (
              <XCircle className="w-3 h-3 text-destructive" />
            )}
            <div>
              <p className="text-sm font-semibold text-foreground" data-testid="text-firehose-status">
                {connected ? "Connected" : "Disconnected"}
              </p>
              <p className="text-xs text-muted-foreground font-mono">wss://bsky.network</p>
            </div>
          </div>
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={onReconnect}
            data-testid="button-reconnect"
          >
            Reconnect
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-muted rounded-lg">
            <p className="text-2xl font-bold text-foreground font-mono" data-testid="text-commits">{commits.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">#commit</p>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <p className="text-2xl font-bold text-foreground font-mono" data-testid="text-identity">{identity.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">#identity</p>
          </div>
          <div className="text-center p-3 bg-muted rounded-lg">
            <p className="text-2xl font-bold text-foreground font-mono" data-testid="text-account">{account.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">#account</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
          <div>
            <p className="text-sm font-semibold text-foreground">Error Rate</p>
            <p className="text-xs text-muted-foreground mt-1">Invalid records discarded</p>
          </div>
          <span className="text-lg font-bold text-foreground font-mono" data-testid="text-error-rate">
            {errorRate.toFixed(2)}%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
