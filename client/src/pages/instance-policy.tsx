import { useQuery } from '@tanstack/react-query';
import {
  Shield,
  AlertTriangle,
  Info,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface InstancePolicy {
  enabled: boolean;
  jurisdiction: string;
  legalContact: string;
  labelerDid: string;
  labels: Array<{
    value: string;
    severity: string;
    reason: string;
    description: string;
  }>;
  autoModeration: {
    enabled: boolean;
    reportThreshold: number;
  };
}

export default function InstancePolicyPage() {
  const { data: policy, isLoading } = useQuery<InstancePolicy>({
    queryKey: ['/api/instance/policy'],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="h-32 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="container mx-auto p-8">
        <div className="text-center text-muted-foreground">
          No instance policy configured
        </div>
      </div>
    );
  }

  const isDefaultConfig = policy.legalContact === 'legal@example.com';
  const labelsByReason = {
    legal: policy.labels.filter((l) => l.reason === 'legal'),
    safety: policy.labels.filter((l) => l.reason === 'safety'),
    quality: policy.labels.filter((l) => l.reason === 'quality'),
    tos: policy.labels.filter((l) => l.reason === 'tos'),
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'alert':
        return <AlertCircle className="h-4 w-4" />;
      case 'warn':
        return <AlertTriangle className="h-4 w-4" />;
      case 'info':
        return <Info className="h-4 w-4" />;
      default:
        return <CheckCircle className="h-4 w-4" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'alert':
        return 'destructive';
      case 'warn':
        return 'default';
      case 'info':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="container mx-auto p-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Shield className="h-8 w-8 text-primary" />
            <h1
              className="text-3xl font-bold"
              data-testid="heading-instance-policy"
            >
              Instance Moderation Policy
            </h1>
          </div>
          {isDefaultConfig && (
            <Badge
              variant="outline"
              className="text-yellow-600 border-yellow-600"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              Using Default Configuration
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-2">
          Transparency information about content moderation and legal compliance
          for this Aurora Prism instance
        </p>
      </div>

      {/* Configuration Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-jurisdiction">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Jurisdiction</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{policy.jurisdiction}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Legal compliance region
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-active-labels">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Active Labels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{policy.labels.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Moderation rules enabled
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-legal-contact">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Legal Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-mono truncate">
              {policy.legalContact}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              DMCA & takedown requests
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Instance Labeler Information */}
      <Card>
        <CardHeader>
          <CardTitle>Instance Labeler</CardTitle>
          <CardDescription>
            This instance operates its own content labeler for legal compliance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium">Labeler DID</span>
            <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
              {policy.labelerDid}
            </code>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium">Status</span>
            <Badge variant={policy.enabled ? 'default' : 'secondary'}>
              {policy.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium">
              Auto-moderation Threshold
            </span>
            <span className="text-sm font-mono">
              {policy.autoModeration.reportThreshold} reports
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Legal Labels */}
      {labelsByReason.legal.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <span>Legal Compliance Labels</span>
            </CardTitle>
            <CardDescription>
              Content removed for legal reasons in this jurisdiction
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {labelsByReason.legal.map((label) => (
                <div
                  key={label.value}
                  className="flex items-start justify-between p-3 border rounded-lg"
                  data-testid={`label-${label.value}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <code className="text-sm font-mono font-semibold">
                        {label.value}
                      </code>
                      <Badge variant={getSeverityColor(label.severity)}>
                        {getSeverityIcon(label.severity)}
                        <span className="ml-1">{label.severity}</span>
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {label.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Safety Labels */}
      {labelsByReason.safety.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Shield className="h-5 w-5 text-yellow-600" />
              <span>Platform Safety Labels</span>
            </CardTitle>
            <CardDescription>
              Content violating platform safety guidelines
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {labelsByReason.safety.map((label) => (
                <div
                  key={label.value}
                  className="flex items-start justify-between p-3 border rounded-lg"
                  data-testid={`label-${label.value}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <code className="text-sm font-mono font-semibold">
                        {label.value}
                      </code>
                      <Badge variant={getSeverityColor(label.severity)}>
                        {getSeverityIcon(label.severity)}
                        <span className="ml-1">{label.severity}</span>
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {label.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quality Labels */}
      {labelsByReason.quality.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Info className="h-5 w-5 text-blue-600" />
              <span>Quality & Spam Labels</span>
            </CardTitle>
            <CardDescription>
              Low-quality content and spam detection
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {labelsByReason.quality.map((label) => (
                <div
                  key={label.value}
                  className="flex items-start justify-between p-3 border rounded-lg"
                  data-testid={`label-${label.value}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <code className="text-sm font-mono font-semibold">
                        {label.value}
                      </code>
                      <Badge variant={getSeverityColor(label.severity)}>
                        {getSeverityIcon(label.severity)}
                        <span className="ml-1">{label.severity}</span>
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {label.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ToS Labels */}
      {labelsByReason.tos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Terms of Service Labels</CardTitle>
            <CardDescription>
              Content violating instance terms of service
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {labelsByReason.tos.map((label) => (
                <div
                  key={label.value}
                  className="flex items-start justify-between p-3 border rounded-lg"
                  data-testid={`label-${label.value}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <code className="text-sm font-mono font-semibold">
                        {label.value}
                      </code>
                      <Badge variant={getSeverityColor(label.severity)}>
                        {getSeverityIcon(label.severity)}
                        <span className="ml-1">{label.severity}</span>
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {label.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
