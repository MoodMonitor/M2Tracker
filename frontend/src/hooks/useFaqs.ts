import { useEffect, useState } from 'react';
import type { FAQ } from '@/types/content';
import { faqs } from '@/lib/utils';

export function useFaqs() {
  const [data, setData] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.resolve(faqs)
      .then((items) => { if (mounted) setData(items); })
      .catch((e) => { if (mounted) setError(e as Error); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  return { data, loading, error } as const;
}