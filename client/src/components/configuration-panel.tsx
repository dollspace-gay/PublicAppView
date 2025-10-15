import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

export function ConfigurationPanel() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border" data-testid="card-connection-settings">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg">Connection Settings</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <Label className="text-sm font-medium text-muted-foreground mb-2">
                Relay WebSocket URL
              </Label>
              <Input
                type="text"
                defaultValue="wss://bsky.network"
                className="font-mono text-sm"
                data-testid="input-relay-url"
              />
              <p className="text-xs text-muted-foreground mt-1">
                AT Protocol relay firehose endpoint
              </p>
            </div>

            <div>
              <Label className="text-sm font-medium text-muted-foreground mb-2">
                API Port
              </Label>
              <Input
                type="number"
                defaultValue="3000"
                className="font-mono text-sm"
                data-testid="input-api-port"
              />
              <p className="text-xs text-muted-foreground mt-1">
                XRPC server listening port
              </p>
            </div>

            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Auto-Reconnect
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Automatically reconnect on connection loss
                </p>
              </div>
              <Switch defaultChecked data-testid="switch-auto-reconnect" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border" data-testid="card-performance-settings">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg">Performance Settings</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <Label className="text-sm font-medium text-muted-foreground mb-2">
                Max Concurrent Connections
              </Label>
              <Input
                type="number"
                defaultValue="1000"
                className="font-mono text-sm"
                data-testid="input-max-connections"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Maximum API connections
              </p>
            </div>

            <div>
              <Label className="text-sm font-medium text-muted-foreground mb-2">
                Event Buffer Size
              </Label>
              <Input
                type="number"
                defaultValue="10000"
                className="font-mono text-sm"
                data-testid="input-buffer-size"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Firehose event buffer capacity
              </p>
            </div>

            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Enable Caching
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Response caching for better performance
                </p>
              </div>
              <Switch defaultChecked data-testid="switch-caching" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-end space-x-4">
        <Button variant="outline" data-testid="button-reset">
          Reset to Defaults
        </Button>
        <Button data-testid="button-save-config">Save Configuration</Button>
      </div>
    </div>
  );
}
