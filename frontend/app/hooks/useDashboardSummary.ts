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
      
      const [systemResponse, schedulersResponse] = await Promise.all([
        fetch('/api/dashboard/system'),
        fetch('/api/dashboard/schedulers'),
      ]);

      const systemData = await systemResponse.json();
      const schedulersData = await schedulersResponse.json();

      // TODO: Fetch candle warmup data when endpoint is available
      const candleWarmup = {
        totalCandles: 1250,
        requiredCandles: 2000,
        isWarmedUp: false,
        timeframes: [
          { name: '15m', loaded: 500, required: 1000 },
          { name: '1h', loaded: 400, required: 500 },
          { name: '4h', loaded: 250, required: 300 },
          { name: '1d', loaded: 100, required: 200 },
        ],
      };

      setData({
        systemHealth: systemData.data,
        schedulers: schedulersData.data,
        candleWarmup,
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
