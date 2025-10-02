import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2 } from "lucide-react";

interface LexiconValidatorProps {
  total: number;
  valid: number;
  invalid: number;
  errorRate: number;
}

const lexicons = [
  { name: "app.bsky.feed.post", version: "v1.0.0" },
  { name: "app.bsky.feed.like", version: "v1.0.0" },
  { name: "app.bsky.feed.repost", version: "v1.0.0" },
  { name: "app.bsky.actor.profile", version: "v1.0.0" },
  { name: "app.bsky.graph.follow", version: "v1.0.0" },
  { name: "app.bsky.graph.block", version: "v1.0.0" },
];

export function LexiconValidatorPanel({ total, valid, invalid, errorRate }: LexiconValidatorProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="border-border" data-testid="card-supported-lexicons">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Supported Lexicons</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Core app.bsky.* schemas</p>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3">
            {lexicons.map((lexicon) => (
              <div key={lexicon.name} className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <span className="text-sm font-semibold font-mono text-foreground">{lexicon.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">{lexicon.version}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border" data-testid="card-validation-stats">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Validation Statistics</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Real-time validation metrics</p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Total Validated</span>
              <span className="text-lg font-bold text-foreground font-mono" data-testid="text-total-validated">
                {total.toLocaleString()}
              </span>
            </div>
            <Progress value={100} className="h-2" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Valid Records</span>
              <span className="text-lg font-bold text-success font-mono" data-testid="text-valid-records">
                {valid.toLocaleString()}
              </span>
            </div>
            <Progress value={total > 0 ? (valid / total) * 100 : 0} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">
              {total > 0 ? ((valid / total) * 100).toFixed(2) : 0}% success rate
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Invalid Records</span>
              <span className="text-lg font-bold text-destructive font-mono" data-testid="text-invalid-records">
                {invalid.toLocaleString()}
              </span>
            </div>
            <Progress value={total > 0 ? (invalid / total) * 100 : 0} className="h-2 bg-destructive/20" />
            <p className="text-xs text-muted-foreground mt-1">{errorRate.toFixed(2)}% error rate</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
