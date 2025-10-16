import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  User,
  Database,
  Trash2,
  ShieldOff,
  Download,
  AlertCircle,
  LogOut,
  Heart,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';

interface UserSettings {
  userDid: string;
  dataCollectionForbidden: boolean;
  lastBackfillAt: string | null;
}

interface UserStats {
  posts: number;
  likes: number;
  reposts: number;
  follows: number;
  totalRecords: number;
}

export default function UserPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [backfillDays, setBackfillDays] = useState<string>('0');

  const { data: sessionData, isLoading: isSessionLoading } = useQuery<{
    session?: { userDid: string };
  }>({
    queryKey: ['/api/auth/session'],
    retry: false,
  });

  const isAuthenticated = !isSessionLoading && !!sessionData?.session;
  const userDid = sessionData?.session?.userDid;

  // Fetch user settings
  const { data: settings } = useQuery<UserSettings>({
    queryKey: ['/api/user/settings'],
    enabled: isAuthenticated,
  });

  // Fetch user statistics
  const { data: stats } = useQuery<UserStats>({
    queryKey: ['/api/user/stats'],
    enabled: isAuthenticated,
    refetchInterval: 5000, // Refresh every 5 seconds to show real-time changes
  });

  // Backfill mutation
  const backfillMutation = useMutation({
    mutationFn: (days: number) =>
      api.post<{ message: string }>('/api/user/backfill', { days }),
    onSuccess: (data) => {
      toast({
        title: 'Backfill Started',
        description:
          data.message || `Backfilling ${backfillDays} days of data...`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/user/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Backfill Failed',
        description: error.message || 'Failed to start backfill',
        variant: 'destructive',
      });
    },
  });

  // Manual backfill likes mutation
  const backfillLikesMutation = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>('/api/user/backfill-likes', {}),
    onSuccess: (data) => {
      toast({
        title: 'Likes Backfill Started',
        description:
          data.message || 'Backfilling your liked posts in the background...',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/user/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Likes Backfill Failed',
        description: error.message || 'Failed to start likes backfill',
        variant: 'destructive',
      });
    },
  });

  // Manual backfill follows mutation
  const backfillFollowsMutation = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>('/api/user/backfill-follows', {}),
    onSuccess: (data) => {
      toast({
        title: 'Follows Backfill Started',
        description:
          data.message ||
          'Backfilling your follows and followers in the background...',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/user/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Follows Backfill Failed',
        description: error.message || 'Failed to start follows backfill',
        variant: 'destructive',
      });
    },
  });

  // Delete all data mutation
  const deleteDataMutation = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>('/api/user/delete-data', {}),
    onSuccess: (data) => {
      toast({
        title: 'Data Deleted',
        description:
          data.message || 'All your data has been removed from this instance',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/user/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user/stats'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete data',
        variant: 'destructive',
      });
    },
  });

  // Toggle data collection mutation
  const toggleCollectionMutation = useMutation({
    mutationFn: (forbidden: boolean) =>
      api.post<{ forbidden: boolean }>('/api/user/toggle-collection', {
        forbidden,
      }),
    onSuccess: (data) => {
      toast({
        title: data.forbidden
          ? 'Data Collection Disabled'
          : 'Data Collection Enabled',
        description: data.forbidden
          ? 'This instance will no longer collect your data'
          : 'This instance can now collect your data from the firehose',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/user/settings'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update setting',
        variant: 'destructive',
      });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => api.post('/api/auth/logout', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/session'] });
      window.location.href = '/';
    },
  });

  const handleBackfill = () => {
    const days = parseInt(backfillDays);
    if (isNaN(days) || days < 0) {
      toast({
        title: 'Invalid Days',
        description:
          'Please enter a valid number (0 for all data, or 1+ for recent days)',
        variant: 'destructive',
      });
      return;
    }

    if (days > 3650) {
      toast({
        title: 'Too Many Days',
        description: 'Maximum backfill is 3650 days (10 years)',
        variant: 'destructive',
      });
      return;
    }

    backfillMutation.mutate(days);
  };

  const handleDeleteData = () => {
    if (
      !window.confirm(
        'Are you sure you want to delete ALL your data from this instance? This action cannot be undone.'
      )
    ) {
      return;
    }

    deleteDataMutation.mutate();
  };

  const handleToggleCollection = (checked: boolean) => {
    toggleCollectionMutation.mutate(checked);
  };

  if (isSessionLoading) {
    return (
      <div className="container mx-auto p-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <User className="h-12 w-12 mx-auto mb-4 text-primary animate-pulse" />
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
              <User className="h-8 w-8 text-primary" />
              <CardTitle>User Panel</CardTitle>
            </div>
            <CardDescription className="text-center">
              Please log in to manage your data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => (window.location.href = '/login')}
              className="w-full"
              data-testid="button-go-login"
            >
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <User className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">User Data Panel</h1>
            <p className="text-sm text-muted-foreground">{userDid}</p>
          </div>
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

      {/* Backfill Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Download className="h-5 w-5 text-primary" />
            <CardTitle>Backfill Your Data</CardTitle>
          </div>
          <CardDescription>
            Import your historical posts and interactions from your Personal
            Data Server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings?.lastBackfillAt && (
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>
                Last backfill:{' '}
                {new Date(settings.lastBackfillAt).toLocaleString()}
              </span>
            </div>
          )}

          <div className="flex items-end space-x-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="backfill-days">
                Number of Days (0 = all time)
              </Label>
              <Input
                id="backfill-days"
                type="number"
                min="0"
                max="3650"
                value={backfillDays}
                onChange={(e) => setBackfillDays(e.target.value)}
                placeholder="0"
                data-testid="input-backfill-days"
              />
              <p className="text-xs text-muted-foreground">
                {parseInt(backfillDays) === 0
                  ? 'Will import ALL your data from your PDS (no date filter)'
                  : parseInt(backfillDays) > 3
                    ? `Will import data from the last ${backfillDays} days from your PDS`
                    : 'Will fetch recent data from the firehose'}
              </p>
            </div>
            <Button
              onClick={handleBackfill}
              disabled={backfillMutation.isPending}
              data-testid="button-backfill"
            >
              {backfillMutation.isPending ? (
                'Processing...'
              ) : (
                <>
                  <Database className="h-4 w-4 mr-2" />
                  Start Backfill
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Manual Backfill Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Download className="h-5 w-5 text-primary" />
            <CardTitle>Manual Backfill Controls</CardTitle>
          </div>
          <CardDescription>
            Manually trigger backfill for specific data types (bypasses cooldown)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-muted/50 rounded-lg space-y-3">
              <div className="flex items-center space-x-2">
                <Heart className="h-5 w-5 text-pink-500" />
                <h3 className="font-semibold">Liked Posts</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Backfill all posts you've liked and their metadata
              </p>
              <Button
                onClick={() => backfillLikesMutation.mutate()}
                disabled={backfillLikesMutation.isPending}
                className="w-full"
                variant="outline"
                data-testid="button-backfill-likes"
              >
                {backfillLikesMutation.isPending ? (
                  'Backfilling...'
                ) : (
                  <>
                    <Heart className="h-4 w-4 mr-2" />
                    Backfill Likes
                  </>
                )}
              </Button>
            </div>

            <div className="p-4 bg-muted/50 rounded-lg space-y-3">
              <div className="flex items-center space-x-2">
                <Users className="h-5 w-5 text-blue-500" />
                <h3 className="font-semibold">Follows & Followers</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Backfill your follows, followers, and their profiles
              </p>
              <Button
                onClick={() => backfillFollowsMutation.mutate()}
                disabled={backfillFollowsMutation.isPending}
                className="w-full"
                variant="outline"
                data-testid="button-backfill-follows"
              >
                {backfillFollowsMutation.isPending ? (
                  'Backfilling...'
                ) : (
                  <>
                    <Users className="h-4 w-4 mr-2" />
                    Backfill Follows
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
            <div className="flex items-start space-x-2">
              <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-yellow-800 dark:text-yellow-200">
                <p className="font-medium">Manual triggers bypass cooldown</p>
                <p className="mt-1">
                  These buttons will start backfills immediately, even if one ran recently.
                  The backfill runs in the background and won't block your session.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Statistics Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle>Your Data on This Instance</CardTitle>
          </div>
          <CardDescription>
            Records currently indexed by this instance from your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Posts</p>
              <p
                className="text-2xl font-bold font-mono"
                data-testid="text-stats-posts"
              >
                {stats?.posts.toLocaleString() || '0'}
              </p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Likes</p>
              <p
                className="text-2xl font-bold font-mono"
                data-testid="text-stats-likes"
              >
                {stats?.likes.toLocaleString() || '0'}
              </p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Reposts</p>
              <p
                className="text-2xl font-bold font-mono"
                data-testid="text-stats-reposts"
              >
                {stats?.reposts.toLocaleString() || '0'}
              </p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Follows</p>
              <p
                className="text-2xl font-bold font-mono"
                data-testid="text-stats-follows"
              >
                {stats?.follows.toLocaleString() || '0'}
              </p>
            </div>
          </div>
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <span className="font-semibold">
                Total: {stats?.totalRecords.toLocaleString() || '0'} records
              </span>
              {' · '}Updates every 5 seconds to reflect real-time changes
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Data Collection Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <ShieldOff className="h-5 w-5 text-primary" />
            <CardTitle>Data Collection Settings</CardTitle>
          </div>
          <CardDescription>
            Control whether this instance collects your data from the network
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="forbid-collection">Forbid Data Collection</Label>
              <p className="text-sm text-muted-foreground">
                Prevent this instance from indexing your posts and interactions
              </p>
            </div>
            <Switch
              id="forbid-collection"
              checked={settings?.dataCollectionForbidden || false}
              onCheckedChange={handleToggleCollection}
              disabled={toggleCollectionMutation.isPending}
              data-testid="switch-forbid-collection"
            />
          </div>

          {settings?.dataCollectionForbidden && (
            <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-md">
              <div className="flex items-start space-x-2">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                <div className="text-sm text-yellow-800 dark:text-yellow-200">
                  <p className="font-medium">
                    Data collection is currently disabled
                  </p>
                  <p className="mt-1">
                    This instance will not collect any new data about your
                    account from the network firehose.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Data Card */}
      <Card className="border-destructive">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            <CardTitle className="text-destructive">Delete All Data</CardTitle>
          </div>
          <CardDescription>
            Permanently remove all your data from this instance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-md">
              <p className="text-sm text-destructive font-medium">
                ⚠️ This action cannot be undone!
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                This will delete all posts, likes, reposts, follows, and other
                data associated with your account from this instance's database.
              </p>
            </div>

            <Button
              variant="destructive"
              onClick={handleDeleteData}
              disabled={deleteDataMutation.isPending}
              data-testid="button-delete-data"
            >
              {deleteDataMutation.isPending ? (
                'Deleting...'
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete All My Data
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
