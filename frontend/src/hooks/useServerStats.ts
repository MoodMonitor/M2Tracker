import { useState, useEffect } from 'react';
import { getServerDailyStats } from '@/services/apiService';
import type { ServerItemsChartData } from '@/types/api';

export interface UseServerStatsResult {
  data: ServerItemsChartData | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook for fetching server daily stats data
 */
export function useServerStats(serverName: string, windowDay: number = 14, enabled: boolean = true): UseServerStatsResult {
  const [data, setData] = useState<ServerItemsChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!serverName || !enabled) {
      setLoading(false);
      return;
    }

    let mounted = true;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const result = await getServerDailyStats(serverName, windowDay);

        if (mounted) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          console.error('Failed to fetch server stats:', err);
          setError(err instanceof Error ? err : new Error('Unknown error'));
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
  }, [serverName, windowDay, enabled]);

  return { data, loading, error };
}
