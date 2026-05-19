'use client';

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../lib/apiBase';

interface EventLog {
  id: string;
  timestamp: string;
  module: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  details: string;
  metadata?: Record<string, unknown>;
}

export interface EventLogsPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface UseEventLogsReturn {
  data: EventLog[];
  loading: boolean;
  error: string | null;
  pagination: EventLogsPagination;
  page: number;
  setPage: (page: number) => void;
  refresh: () => void;
}

async function readOkJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  if (body.ok === false) {
    throw new Error(body.error || body.message || 'Request failed');
  }
  if (body.ok !== true && body.success === false) {
    throw new Error(body.error || body.message || 'Request failed');
  }
  return body;
}

export function useEventLogs(
  module?: string,
  pageSize: number = 8
): UseEventLogsReturn {
  const [data, setData] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<EventLogsPagination>({
    page: 1,
    pageSize,
    total: 0,
    totalPages: 1,
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const base = getApiBase();
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (module) params.set('module', module);

      const response = await fetch(`${base}/dashboard/events?${params}`);
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
          metadata:
            row.metadata && typeof row.metadata === 'object'
              ? (row.metadata as Record<string, unknown>)
              : undefined,
        }))
      );

      const p = result.pagination as Record<string, unknown> | undefined;
      if (p) {
        setPagination({
          page: Number(p.page) || page,
          pageSize: Number(p.pageSize) || pageSize,
          total: Number(p.total) || 0,
          totalPages: Math.max(1, Number(p.totalPages) || 1),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch event logs');
    } finally {
      setLoading(false);
    }
  }, [module, page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setPageSafe = (next: number) => {
    setPage(Math.max(1, next));
  };

  return {
    data,
    loading,
    error,
    pagination,
    page,
    setPage: setPageSafe,
    refresh: fetchData,
  };
}
