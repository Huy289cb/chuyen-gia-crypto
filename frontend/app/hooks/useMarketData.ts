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

      const [candlesResponse, indicatorsResponse, signalsResponse] = await Promise.all([
        fetch(`/api/market/candles?symbol=${symbol}&timeframe=${timeframe}&limit=100`),
        fetch(`/api/market/indicators?symbol=${symbol}&timeframe=${timeframe}`),
        fetch(`/api/market/signals?symbol=${symbol}&limit=5`),
      ]);

      const candlesData = await candlesResponse.json();
      const indicatorsData = await indicatorsResponse.json();
      const signalsData = await signalsResponse.json();

      // Format candles for the chart
      const formattedCandles = candlesData.candles?.map((candle: any) => ({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })) || [];

      // Get latest indicator values
      const indicators = indicatorsData.indicators || {};
      const latestIndicators = {
        ma50: indicators.sma50?.filter((v: any) => v !== null).pop() || 0,
        ma200: indicators.sma50?.filter((v: any) => v !== null).slice(-200)[0] || 0,
        rsi: indicators.rsi14?.filter((v: any) => v !== null).pop() || 50,
        macd: 0, // TODO: Implement MACD calculation
      };

      // Format signals
      const formattedSignals = signalsData.signals?.map((signal: any) => ({
        id: signal.id,
        grade: signal.grade,
        confidence: signal.confidence,
        playbook: signal.playbook,
        regime: signal.regime,
        pass: signal.pass,
      })) || [];

      setData({
        candles: formattedCandles,
        indicators: latestIndicators,
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
