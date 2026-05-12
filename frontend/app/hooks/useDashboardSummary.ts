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

      const systemData = await systemResponse.json();
      const schedulersData = await schedulersResponse.json();
      const warmupData = await warmupResponse.json();

      setData({
        systemHealth: systemData.data,
        schedulers: schedulersData.data,
        candleWarmup: warmupData.data,
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
