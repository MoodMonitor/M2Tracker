import { useEffect, useState } from 'react';
import { getDashboardInit } from '@/services/apiService';
import type { DashboardInitResponse, ServerCurrency } from '@/types/api';

export function useDashboardInfo(serverName: string) {
  const [data, setData] = useState<DashboardInitResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!serverName) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    getDashboardInit(serverName)
      .then((res) => { 
        if (mounted) {
          // Coerce thresholds to numbers and sort currencies descending
          if (res.server && res.server.currencies) {
            res.server.currencies = res.server.currencies
              .map(c => ({ ...c, threshold: Number(c.threshold) }))
              .sort((a, b) => b.threshold - a.threshold);
          }
          setData(res); 
        }
      })
      .catch((e) => { if (mounted) setError(e as Error); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [serverName]);

  return { data, loading, error } as const;
}
