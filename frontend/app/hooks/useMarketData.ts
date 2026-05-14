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
    sma20: number | null;
    sma50: number | null;
    rsi14: number | null;
    atr14: number | null;
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

      const [candlesResponse, indicatorsResponse, signalsResponse] = await Promise.all([
        fetch(`/api/market/candles?symbol=${symbol}&timeframe=${timeframe}&limit=100`),
        fetch(`/api/market/indicators?symbol=${symbol}&timeframe=${timeframe}`),
        fetch(`/api/market/signals?symbol=${symbol}&limit=5`),
      ]);

      const candlesData = await candlesResponse.json();
      const indicatorsData = await indicatorsResponse.json();
      const signalsData = await signalsResponse.json();

      if (!candlesResponse.ok) {
        throw new Error(candlesData.error || 'Failed to load candles');
      }
      if (!indicatorsResponse.ok) {
        throw new Error(indicatorsData.error || 'Failed to load indicators');
      }
      if (!signalsResponse.ok) {
        throw new Error(signalsData.error || 'Failed to load signals');
      }

      const formattedCandles =
        candlesData.candles?.map((candle: Record<string, number>) => ({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })) || [];

      const latest = indicatorsData.latest || {};
      const indicators = {
        sma20: typeof latest.sma20 === 'number' ? latest.sma20 : null,
        sma50: typeof latest.sma50 === 'number' ? latest.sma50 : null,
        rsi14: typeof latest.rsi14 === 'number' ? latest.rsi14 : null,
        atr14: typeof latest.atr14 === 'number' ? latest.atr14 : null,
      };

      const formattedSignals =
        signalsData.signals?.map((signal: Record<string, unknown>) => ({
          id: String(signal.id),
          grade: String(signal.grade ?? ''),
          confidence: Number(signal.confidence ?? 0),
          playbook: String(signal.playbook ?? ''),
          regime: String(signal.regime ?? ''),
          pass: Boolean(signal.pass),
        })) || [];

      setData({
        candles: formattedCandles,
        indicators,
        signals: formattedSignals,
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
