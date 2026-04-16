import { useEffect, useState } from 'react';
import { getShopWindowStats } from '@/services/apiService';
import type { ShopChartData } from '@/types/api';

export function useShopStats(serverName: string, windowDay: number = 14, enabled: boolean = true) {
  const [data, setData] = useState<ShopChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    
    const fetchData = async () => {
      if (!enabled || !serverName) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const stats = await getShopWindowStats(serverName, windowDay);
        if (mounted) {
          setData(stats);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
          console.error('Failed to fetch shop stats:', err);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
  }, [serverName, windowDay, enabled]);

  return { data, loading, error } as const;
}
