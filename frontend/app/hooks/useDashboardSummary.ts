'use client';

import { useState, useEffect } from 'react';

interface DashboardSummaryData {
  systemHealth: {
    workerStatus: string;
    databaseStatus: string;
    safetyValidation: string;
    btcOnlyScope: boolean;
    lockStatus: string;
  };
  schedulers: Array<{
    name: string;
    status: string;
    lastRun: string;
    nextRun: string;
    cron: string;
    lastRunAt?: string | null;
  }>;
  candleWarmup: {
    totalCandles: number;
    requiredCandles: number;
    isWarmedUp: boolean;
    timeframes: Array<{
      name: string;
      loaded: number;
      required: number;
    }>;
  };
}

interface UseDashboardSummaryReturn {
  data: DashboardSummaryData | null;
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

export function useDashboardSummary(): UseDashboardSummaryReturn {
  const [data, setData] = useState<DashboardSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [systemResponse, schedulersResponse, warmupResponse] = await Promise.all([
        fetch('/api/dashboard/system'),
        fetch('/api/dashboard/schedulers'),
        fetch('/api/dashboard/warmup'),
      ]);

      const [systemBody, schedulersBody, warmupBody] = await Promise.all([
        readOkJson(systemResponse),
        readOkJson(schedulersResponse),
        readOkJson(warmupResponse),
      ]);

      setData({
        systemHealth: systemBody.data,
        schedulers: schedulersBody.data,
        candleWarmup: warmupBody.data,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}
