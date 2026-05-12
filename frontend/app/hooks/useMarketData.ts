'use client';

import { useState, useEffect } from 'react';

interface MarketData {
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  indicators: {
    ma50: number;
    ma200: number;
    rsi: number;
    macd: number;
  };
  signals: Array<{
    id: string;
    grade: string;
    confidence: number;
    playbook: string;
    regime: string;
    pass: boolean;
  }>;
}

interface UseMarketDataReturn {
  data: MarketData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMarketData(symbol: string = 'BTC', timeframe: string = '15m'): UseMarketDataReturn {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // TODO: Replace with actual API calls
      // const candlesResponse = await fetch(`/api/market/candles?symbol=${symbol}&timeframe=${timeframe}`);
      // const indicatorsResponse = await fetch(`/api/market/indicators?symbol=${symbol}`);
      // const signalsResponse = await fetch(`/api/market/signals?symbol=${symbol}`);
      
      // Mock data for now
      setData({
        candles: [],
        indicators: {
          ma50: 94250,
          ma200: 92100,
          rsi: 58.5,
          macd: 125.5,
        },
        signals: [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch market data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [symbol, timeframe]);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}
