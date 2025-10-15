import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  Trash2,
  Play,
  AlertTriangle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { api } from '@/lib/api';

interface PDSFetcherStats {
  total: number;
  byType: Record<string, number>;
  byRetryCount: Record<string, number>;
  oldestEntry: number;
}

export function PDSFetcherStatus() {
  const [stats, setStats] = useState<PDSFetcherStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const response = await api.get<{ stats: PDSFetcherStats }>(
        '/api/admin/pds-fetcher/stats'
      );
      setStats(response.stats);
    } catch (error) {
      console.error('Failed to fetch PDS fetcher stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: string) => {
    try {
      setActionLoading(action);
      const endpoint =
        action === 'clear'
          ? '/api/admin/pds-fetcher/clear'
          : '/api/admin/pds-fetcher/process';
      await api.post(endpoint, {});

      // Refresh stats after action
      await fetchStats();
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const getStatusColor = (total: number) => {
    if (total === 0) return 'bg-green-100 text-green-800';
    if (total < 10) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const getStatusIcon = (total: number) => {
    if (total === 0) return <CheckCircle className="h-4 w-4" />;
    if (total < 10) return <Clock className="h-4 w-4" />;
    return <AlertTriangle className="h-4 w-4" />;
  };

  if (!stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            PDS Data Fetcher
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-gray-500">
            {loading ? 'Loading...' : 'No data available'}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            PDS Data Fetcher
          </div>
          <div className="flex items-center gap-2">
            <Badge className={getStatusColor(stats.total)}>
              {getStatusIcon(stats.total)}
              {stats.total} incomplete
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchStats}
              disabled={loading}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-gray-500">Total Incomplete</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold">
              {formatDuration(stats.oldestEntry)}
            </div>
            <div className="text-sm text-gray-500">Oldest Entry</div>
          </div>
        </div>

        {/* By Type Breakdown */}
        {Object.keys(stats.byType).length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">By Type</h4>
            <div className="space-y-1">
              {Object.entries(stats.byType).map(([type, count]) => (
                <div key={type} className="flex justify-between text-sm">
                  <span className="capitalize">{type}</span>
                  <Badge variant="outline">{count}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* By Retry Count */}
        {Object.keys(stats.byRetryCount).length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">By Retry Count</h4>
            <div className="space-y-1">
              {Object.entries(stats.byRetryCount)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([retries, count]) => (
                  <div key={retries} className="flex justify-between text-sm">
                    <span>{retries} retries</span>
                    <Badge variant="outline">{count}</Badge>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('process')}
            disabled={actionLoading === 'process' || stats.total === 0}
            className="flex-1"
          >
            <Play className="h-4 w-4 mr-1" />
            {actionLoading === 'process' ? 'Processing...' : 'Process Now'}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleAction('clear')}
            disabled={actionLoading === 'clear' || stats.total === 0}
            className="flex-1"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {actionLoading === 'clear' ? 'Clearing...' : 'Clear All'}
          </Button>
        </div>

        {/* Info Text */}
        {stats.total > 0 && (
          <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
            <strong>Note:</strong> Incomplete entries are automatically
            processed every 30 seconds. Use "Process Now" to trigger immediate
            processing, or "Clear All" to remove all incomplete entries.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
