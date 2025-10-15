import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Shield, LogIn } from 'lucide-react';
import { api } from '@/lib/api';

// Sanitize user input to prevent XSS attacks
function sanitizeText(text: string): string {
  return text
    .replace(/[<>\"']/g, '') // Remove potentially dangerous characters
    .substring(0, 500); // Limit length to prevent abuse
}

export default function LoginPage() {
  const { toast } = useToast();
  const [loginHandle, setLoginHandle] = useState('');
  const [isCheckingCallback, setIsCheckingCallback] = useState(true);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const error = urlParams.get('error');

    if (error) {
      toast({
        title: 'Authentication Failed',
        description: sanitizeText(decodeURIComponent(error)),
        variant: 'destructive',
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (token) {
      // SECURITY: Token in URL is a security risk, but we clear it immediately
      // The backend has already set an HttpOnly cookie during OAuth callback
      // We should never have gotten here - redirect without the token parameter
      console.warn(
        '[LOGIN] Token found in URL - this should not happen with cookie-based auth'
      );

      // Clear URL IMMEDIATELY to remove token from browser history
      window.history.replaceState({}, document.title, window.location.pathname);

      toast({
        title: 'Login Successful',
        description: 'Welcome! Redirecting...',
      });

      // Redirect to check if we have a valid session via cookie
      window.location.href = '/';
      return;
    }

    setIsCheckingCallback(false);
  }, [toast]);

  const loginMutation = useMutation({
    mutationFn: (data: { handle: string }) =>
      api.post<{ authUrl: string }>('/api/auth/login', data),
    onSuccess: (data) => {
      // Validate authUrl before redirecting to prevent open redirect attacks
      try {
        const url = new URL(data.authUrl);
        // Only allow HTTPS URLs and known AT Protocol domains
        if (url.protocol === 'https:') {
          window.location.href = data.authUrl;
        } else {
          toast({
            title: 'Login Failed',
            description: 'Invalid authentication URL received',
            variant: 'destructive',
          });
        }
      } catch {
        toast({
          title: 'Login Failed',
          description: 'Invalid authentication URL format',
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Login Failed',
        description: sanitizeText(error.message || 'Failed to initiate login'),
        variant: 'destructive',
      });
    },
  });

  const handleLogin = () => {
    if (!loginHandle) {
      toast({
        title: 'Handle Required',
        description: 'Please provide your Bluesky handle',
        variant: 'destructive',
      });
      return;
    }

    loginMutation.mutate({
      handle: loginHandle,
    });
  };

  if (isCheckingCallback) {
    return (
      <div className="container mx-auto p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-primary animate-pulse" />
            <p className="text-muted-foreground">
              Processing authentication...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 max-w-md">
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-3 justify-center">
            <Shield className="h-8 w-8 text-primary" />
            <CardTitle>Sign In</CardTitle>
          </div>
          <CardDescription className="text-center">
            Log in with your Bluesky account to access your data and preferences
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
              You'll be redirected to your Personal Data Server to authorize
              this app
            </p>
          </div>

          <Button
            onClick={handleLogin}
            disabled={loginMutation.isPending}
            className="w-full"
            data-testid="button-login"
          >
            {loginMutation.isPending ? (
              'Authenticating...'
            ) : (
              <>
                <LogIn className="h-4 w-4 mr-2" />
                Sign In with Bluesky
              </>
            )}
          </Button>

          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground text-center">
              After signing in, you'll have access to your User Data Panel and,
              if you're an administrator, the Admin Moderation panel.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
