import { useEffect, useState } from 'react';
import { getQuickStats24h } from '@/services/apiService';
import type { QuickStats24hData, Top10Response, StatEntry, Top10Item } from '@/types/api';

/**
 * Transform API response item to StatEntry format
 */
function transformToStatEntry(item: Top10Item): StatEntry {
  return {
    name: item.item_name,
    changePct: item.change_pct,
    changeAbs: item.change_abs,
    currentValue: item.price_now,
    previousValue: item.price_prev,
    rank: item.rank,
  };
}

/**
 * Transform amount change item to StatEntry format
 */
function transformAmountToStatEntry(item: Top10Item): StatEntry {
  return {
    name: item.item_name,
    changePct: item.change_pct,
    changeAbs: item.amount_now - item.amount_prev,
    currentValue: item.amount_now,
    previousValue: item.amount_prev,
    rank: item.rank,
  };
}

/**
 * Transform shop change item to StatEntry format
 */
function transformShopToStatEntry(item: Top10Item): StatEntry {
  const now = item.shops_now ?? 0;
  const prev = item.shops_prev ?? 0;
  // Calculate percent change as a decimal. Handle prev=0 gracefully.
  const pct = prev === 0 ? (now > 0 ? 1 : 0) : (now - prev) / prev;
  return {
    name: item.item_name,
    changePct: pct,
    changeAbs: now - prev,
    currentValue: now,
    previousValue: prev,
    rank: item.rank,
  };
}

export function useQuickStats24h(serverName: string, enabled: boolean = true) {
  const [data, setData] = useState<QuickStats24hData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    
    const fetchData = async () => {
      if (!serverName || !enabled) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const response = await getQuickStats24h(serverName);
        
        const stats: QuickStats24hData = {
          priceUp: response.price_up.map(transformToStatEntry),
          priceDown: response.price_down.map(transformToStatEntry),
          amountUp: response.amount_change_up.map(transformAmountToStatEntry),
          amountDown: response.amount_change_down.map(transformAmountToStatEntry),
          shopsUp: response.shop_change_up.map(transformShopToStatEntry),
          shopsDown: response.shop_change_down.map(transformShopToStatEntry),
        };
        
        if (mounted) {
          setData(stats);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
          console.error('Failed to fetch 24h stats:', err);
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
  }, [serverName, enabled]);

  return { data, loading, error } as const;
}
