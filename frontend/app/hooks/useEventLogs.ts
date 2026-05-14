'use client';

import { useState, useEffect } from 'react';

interface EventLog {
  id: string;
  timestamp: string;
  module: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  details: string;
  metadata?: Record<string, unknown>;
}

interface UseEventLogsReturn {
  data: EventLog[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

async function readOkJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return body;
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
        ? `/api/dashboard/events?limit=${limit}&module=${encodeURIComponent(module)}`
        : `/api/dashboard/events?limit=${limit}`;

      const response = await fetch(url);
      const result = await readOkJson(response);

      const rows = (result.data || []) as Record<string, unknown>[];
      setData(
        rows.map((row) => ({
          id: String(row.id ?? ''),
          timestamp: String(row.timestamp ?? ''),
          module: String(row.module ?? ''),
          message: String(row.message ?? ''),
          severity: (row.severity as EventLog['severity']) || 'info',
          details: String(row.details ?? ''),
          metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : undefined,
        }))
      );
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
