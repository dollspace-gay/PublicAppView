import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Shield, Search, Tag, Trash2, AlertCircle, LogIn, LogOut } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

export default function AdminModerationPage() {
  const { toast } = useToast();
  const [subjectUri, setSubjectUri] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [comment, setComment] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loginHandle, setLoginHandle] = useState("");

  // Check authentication status on mount and handle OAuth callback
  useEffect(() => {
    const checkAuth = async () => {
      // Check if returning from OAuth callback
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      const error = urlParams.get('error');
      
      if (error) {
        toast({
          title: "Authentication Failed",
          description: decodeURIComponent(error),
          variant: "destructive",
        });
        window.history.replaceState({}, document.title, window.location.pathname);
        setIsAuthChecking(false);
        return;
      }
      
      if (token) {
        localStorage.setItem("dashboard_token", token);
        setIsAuthenticated(true);
        toast({
          title: "Login Successful",
          description: "Welcome! You have been authenticated successfully.",
        });
        window.history.replaceState({}, document.title, window.location.pathname);
        setIsAuthChecking(false);
        return;
      }

      // Check existing token
      const existingToken = localStorage.getItem("dashboard_token");
      if (!existingToken) {
        setIsAuthenticated(false);
        setIsAuthChecking(false);
        return;
      }

      try {
        const res = await apiRequest('GET', '/api/auth/session');
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
          localStorage.removeItem("dashboard_token");
        }
      } catch (error) {
        setIsAuthenticated(false);
        localStorage.removeItem("dashboard_token");
      } finally {
        setIsAuthChecking(false);
      }
    };

    checkAuth();
  }, [toast]);

  // Login mutation - initiates OAuth flow
  const loginMutation = useMutation({
    mutationFn: async (data: { handle: string }) => {
      const res = await apiRequest('POST', '/api/auth/login', data);
      return await res.json();
    },
    onSuccess: (data) => {
      // Redirect to PDS for OAuth authorization
      window.location.href = data.authUrl;
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
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/auth/logout');
      return await res.json();
    },
    onSuccess: () => {
      localStorage.removeItem("dashboard_token");
      setIsAuthenticated(false);
      toast({
        title: "Logged Out",
        description: "You have been logged out successfully.",
      });
    },
  });

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
    mutationFn: async (data: { subject: string; label: string; comment?: string }) => {
      const res = await apiRequest('POST', '/api/admin/labels/apply', data);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Label Applied",
        description: "The moderation label has been successfully applied.",
      });
      setSubjectUri("");
      setSelectedLabel("");
      setComment("");
      if (searchQuery) {
        refetchLabels();
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
    mutationFn: async (labelUri: string) => {
      const res = await apiRequest('DELETE', `/api/admin/labels?uri=${encodeURIComponent(labelUri)}`);
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Label Removed",
        description: "The moderation label has been removed.",
      });
      refetchLabels();
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

  if (isAuthChecking) {
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
            <h1 className="text-3xl font-bold" data-testid="heading-admin-moderation">Admin Moderation</h1>
          </div>
          <p className="text-muted-foreground mt-2">
            Apply instance-level moderation labels to content and users
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
          <CardTitle>Usage Guide</CardTitle>
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
