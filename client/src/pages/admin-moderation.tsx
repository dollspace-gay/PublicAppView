import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Shield, Search, Tag, Trash2, AlertCircle, LogIn, LogOut, RefreshCw, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { PDSFetcherStatus } from "@/components/pds-fetcher-status";
import { FirehoseStatus } from "@/components/firehose-status";

interface Label {
  uri: string;
  src: string;
  subject: string;
  val: string;
  neg: boolean;
  createdAt: string;
}

interface InstanceLabel {
  value: string;
  severity: string;
  reason: string;
  description: string;
}

export default function AdminControlPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [subjectUri, setSubjectUri] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [comment, setComment] = useState("");
  const [loginHandle, setLoginHandle] = useState("");
  const [firehoseConnected, setFirehoseConnected] = useState(false);
  const [firehoseStats, setFirehoseStats] = useState({
    commits: 0,
    identity: 0,
    account: 0,
    errorRate: 0
  });

  const { data: session, isLoading: isSessionLoading } = useQuery({
    queryKey: ["/api/auth/session"],
    retry: false,
  });

  const isAuthenticated = !isSessionLoading && !!session;

  // Login mutation - initiates OAuth flow
  const loginMutation = useMutation({
    mutationFn: (data: { handle: string }) => api.post<{ authUrl: string }>('/api/auth/login', data),
    onSuccess: (data) => {
      // Validate authUrl before redirecting to prevent open redirect attacks
      try {
        const url = new URL(data.authUrl);
        // Only allow https protocol
        if (url.protocol !== 'https:') {
          throw new Error('Invalid redirect URL protocol');
        }
        // Validate it's not redirecting to localhost or internal IPs
        const hostname = url.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.') || 
            hostname.startsWith('10.') || hostname === '[::1]') {
          throw new Error('Invalid redirect URL hostname');
        }
        // Redirect to PDS for OAuth authorization
        window.location.href = data.authUrl;
      } catch (error) {
        toast({
          title: "Login Failed",
          description: "Invalid authentication URL returned from server",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Login Failed",
        description: error.message || "Failed to initiate login",
        variant: "destructive",
      });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => api.post('/api/auth/logout', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      toast({
        title: "Logged Out",
        description: "You have been logged out successfully.",
      });
    },
  });

  // Fetch firehose status
  const { data: metrics } = useQuery({
    queryKey: ["/api/metrics"],
    refetchInterval: 5000,
  });

  // Update firehose stats when metrics change
  useEffect(() => {
    if (metrics) {
      const metricsData = metrics as any;
      setFirehoseConnected(metricsData.firehoseStatus?.connected || false);
      setFirehoseStats({
        commits: metricsData.eventCounts?.["#commit"] || 0,
        identity: metricsData.eventCounts?.["#identity"] || 0,
        account: metricsData.eventCounts?.["#account"] || 0,
        errorRate: metricsData.errorRate || 0
      });
    }
  }, [metrics]);

  // Firehose reconnect handler
  const handleReconnect = async () => {
    try {
      await api.post("/api/firehose/reconnect", {});
      toast({
        title: "Reconnect Initiated",
        description: "Attempting to reconnect to firehose...",
      });
    } catch (error) {
      toast({
        title: "Reconnect Failed",
        description: "Failed to reconnect to firehose",
        variant: "destructive",
      });
    }
  };

  // Fetch available labels
  const { data: policy } = useQuery<{ labels: InstanceLabel[] }>({
    queryKey: ['/api/instance/policy'],
  });

  // Fetch existing labels for a subject
  const { data: existingLabels, refetch: refetchLabels } = useQuery<Label[]>({
    queryKey: ['/api/admin/labels', searchQuery],
    enabled: searchQuery.length > 0,
  });

  // Apply label mutation
  const applyLabelMutation = useMutation({
    mutationFn: (data: { subject: string; label: string; comment?: string }) =>
      api.post('/api/admin/labels/apply', data),
    onSuccess: () => {
      toast({
        title: "Label Applied",
        description: "The moderation label has been successfully applied.",
      });
      setSubjectUri("");
      setSelectedLabel("");
      setComment("");
      if (searchQuery) {
        queryClient.invalidateQueries({ queryKey: ['/api/admin/labels', searchQuery] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to apply label",
        variant: "destructive",
      });
    },
  });

  // Remove label mutation
  const removeLabelMutation = useMutation({
    mutationFn: (labelUri: string) =>
      api.delete(`/api/admin/labels?uri=${encodeURIComponent(labelUri)}`),
    onSuccess: () => {
      toast({
        title: "Label Removed",
        description: "The moderation label has been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/labels', searchQuery] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove label",
        variant: "destructive",
      });
    },
  });

  const handleApplyLabel = () => {
    if (!subjectUri || !selectedLabel) {
      toast({
        title: "Missing Information",
        description: "Please provide both subject URI and label",
        variant: "destructive",
      });
      return;
    }

    applyLabelMutation.mutate({
      subject: subjectUri,
      label: selectedLabel,
      comment: comment || undefined,
    });
  };

  const handleSearch = () => {
    if (searchQuery) {
      refetchLabels();
    }
  };

  const getLabelColor = (reason: string) => {
    switch (reason) {
      case 'legal': return 'destructive';
      case 'safety': return 'default';
      case 'quality': return 'secondary';
      default: return 'outline';
    }
  };

  const handleLogin = () => {
    if (!loginHandle) {
      toast({
        title: "Handle Required",
        description: "Please provide your Bluesky handle",
        variant: "destructive",
      });
      return;
    }

    loginMutation.mutate({
      handle: loginHandle,
    });
  };

  if (isSessionLoading) {
    return (
      <div className="container mx-auto p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-primary animate-pulse" />
            <p className="text-muted-foreground">Checking authentication...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-8 max-w-md">
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-3 justify-center">
              <Shield className="h-8 w-8 text-primary" />
              <CardTitle>Admin Login</CardTitle>
            </div>
            <CardDescription className="text-center">
              Sign in with your authorized admin account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-handle">Bluesky Handle</Label>
              <Input
                id="login-handle"
                type="text"
                placeholder="username.bsky.social"
                value={loginHandle}
                onChange={(e) => setLoginHandle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                data-testid="input-login-handle"
              />
              <p className="text-xs text-muted-foreground">
                You'll be redirected to your Personal Data Server to authorize this app
              </p>
            </div>

            <Button
              onClick={handleLogin}
              disabled={loginMutation.isPending}
              className="w-full"
              data-testid="button-login"
            >
              {loginMutation.isPending ? (
                "Authenticating..."
              ) : (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </>
              )}
            </Button>

            <div className="pt-4 border-t">
              <p className="text-xs text-muted-foreground text-center">
                Only authorized administrators can access this panel. Contact your instance admin if you need access.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold" data-testid="heading-admin-control-panel">Admin Control Panel</h1>
          </div>
          <p className="text-muted-foreground mt-2">
            Manage instance moderation, system controls, and administrative functions
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>

      {/* System Controls Section */}
      <div className="grid gap-6 mb-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PDSFetcherStatus />
          <FirehoseStatus
            connected={firehoseConnected}
            commits={firehoseStats.commits}
            identity={firehoseStats.identity}
            account={firehoseStats.account}
            errorRate={firehoseStats.errorRate}
            onReconnect={handleReconnect}
          />
        </div>
      </div>

      {/* Moderation Section */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Apply Label Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Tag className="h-5 w-5" />
              <span>Apply Label</span>
            </CardTitle>
            <CardDescription>
              Apply a moderation label to content or user
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject-uri">Subject URI or DID</Label>
              <Input
                id="subject-uri"
                placeholder="at://did:plc:xxx/app.bsky.feed.post/abc or did:plc:xxx"
                value={subjectUri}
                onChange={(e) => setSubjectUri(e.target.value)}
                data-testid="input-subject-uri"
              />
              <p className="text-xs text-muted-foreground">
                Enter an AT URI for content or a DID for a user account
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="label-select">Label</Label>
              <Select value={selectedLabel} onValueChange={setSelectedLabel}>
                <SelectTrigger id="label-select" data-testid="select-label">
                  <SelectValue placeholder="Select a label" />
                </SelectTrigger>
                <SelectContent>
                  {policy?.labels.map((label) => (
                    <SelectItem key={label.value} value={label.value}>
                      {label.value} ({label.reason})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedLabel && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm">
                  {policy?.labels.find(l => l.value === selectedLabel)?.description}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="comment">Comment (Optional)</Label>
              <Textarea
                id="comment"
                placeholder="Internal note about why this label was applied..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                data-testid="input-comment"
              />
            </div>

            <Button 
              onClick={handleApplyLabel}
              disabled={applyLabelMutation.isPending || !subjectUri || !selectedLabel}
              className="w-full"
              data-testid="button-apply-label"
            >
              {applyLabelMutation.isPending ? "Applying..." : "Apply Label"}
            </Button>
          </CardContent>
        </Card>

        {/* Search Labels Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Search className="h-5 w-5" />
              <span>Search Labels</span>
            </CardTitle>
            <CardDescription>
              View existing labels on content or users
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="search-uri">Subject URI or DID</Label>
              <div className="flex space-x-2">
                <Input
                  id="search-uri"
                  placeholder="at://... or did:plc:..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="input-search-uri"
                />
                <Button 
                  onClick={handleSearch}
                  disabled={!searchQuery}
                  data-testid="button-search"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {existingLabels && (
              <div className="space-y-3 mt-4">
                <p className="text-sm font-medium">
                  {existingLabels.length} label(s) found
                </p>
                
                {existingLabels.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No labels found for this subject</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {existingLabels.map((label) => (
                      <div 
                        key={label.uri} 
                        className="flex items-center justify-between p-3 border rounded-lg"
                        data-testid={`label-item-${label.uri}`}
                      >
                        <div className="flex-1">
                          <code className="text-sm font-mono font-semibold">{label.val}</code>
                          <p className="text-xs text-muted-foreground mt-1">
                            Applied {new Date(label.createdAt).toLocaleString()}
                          </p>
                          {label.neg && (
                            <Badge variant="outline" className="text-xs mt-1">Negation</Badge>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLabelMutation.mutate(label.uri)}
                          disabled={removeLabelMutation.isPending}
                          data-testid={`button-remove-${label.uri}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Help Section */}
      <Card>
        <CardHeader>
          <CardTitle>Moderation Usage Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Subject Format Examples:</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li><code>at://did:plc:xxx/app.bsky.feed.post/abc123</code> - Label a specific post</li>
              <li><code>did:plc:xxx</code> - Label an entire account</li>
              <li><code>at://did:plc:xxx/app.bsky.actor.profile/self</code> - Label a profile</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold mb-2">Label Actions:</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li><Badge variant="destructive">Legal</Badge> - Content removed for legal compliance</li>
              <li><Badge variant="default">Safety</Badge> - Content violates platform safety</li>
              <li><Badge variant="secondary">Quality</Badge> - Low-quality or spam content</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
