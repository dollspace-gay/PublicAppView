import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Event {
  type: string;
  lexicon: string;
  did: string;
  action: string;
  timestamp: string;
}

interface EventStreamProps {
  events: Event[];
}

export function EventStream({ events }: EventStreamProps) {
  return (
    <Card className="border-border" data-testid="card-event-stream">
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Real-time Event Stream</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Live events from the AT Protocol firehose</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <ScrollArea className="h-64">
          <div className="space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No events yet. Waiting for firehose data...</p>
            ) : (
              events.map((event, i) => (
                <div 
                  key={i} 
                  className="flex items-start space-x-3 p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                  data-testid={`event-item-${i}`}
                >
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                    event.type === "#commit" ? "bg-primary" : 
                    event.type === "#identity" ? "bg-warning" : "bg-accent"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold font-mono ${
                        event.type === "#commit" ? "text-primary" : 
                        event.type === "#identity" ? "text-warning" : "text-accent"
                      }`}>
                        {event.type}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">{event.timestamp}</span>
                    </div>
                    <p className="text-sm text-foreground truncate">
                      <span className="font-mono text-accent">{event.lexicon}</span> - 
                      <span className="text-muted-foreground ml-1">{event.did}</span> - 
                      <span className="font-medium ml-1">{event.action}</span>
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
