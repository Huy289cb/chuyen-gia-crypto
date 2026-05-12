'use client';

import { useState, useEffect } from 'react';

interface EventLog {
  id: string;
  timestamp: string;
  module: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  details: string;
}

interface UseEventLogsReturn {
  data: EventLog[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useEventLogs(module?: string, limit: number = 20): UseEventLogsReturn {
  const [data, setData] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const url = module
        ? `/api/dashboard/events?limit=${limit}&module=${module}`
        : `/api/dashboard/events?limit=${limit}`;

      const response = await fetch(url);
      const result = await response.json();

      setData(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch event logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [module, limit]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}
