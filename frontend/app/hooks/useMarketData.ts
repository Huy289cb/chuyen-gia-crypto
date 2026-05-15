'use client';

import { useCallback, useContext, useEffect, useState } from 'react';
import { V3DashboardDataContext, type MarketTimeframe } from '../contexts/V3DashboardDataContext';
import { loadMarketData, type DashboardMarketData } from '../lib/v3DashboardFetchers';

export type MarketData = DashboardMarketData;
export type { MarketTimeframe } from '../contexts/V3DashboardDataContext';

export interface UseMarketDataReturn {
  data: MarketData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  timeframe: MarketTimeframe;
  setTimeframe: (t: MarketTimeframe) => void;
}

/**
 * When used inside `V3DashboardDataProvider`, market data and timeframe are shared
 * (one triplet of `/api/market/*` requests per symbol/timeframe for the whole dashboard).
 * Outside the provider, falls back to a local fetch (legacy).
 */
export function useMarketData(symbol: string = 'BTC', legacyTimeframe?: string) {
  const ctx = useContext(V3DashboardDataContext);
  const inside = Boolean(ctx);

  const [standaloneTf, setStandaloneTf] = useState<MarketTimeframe>(
    () => (legacyTimeframe as MarketTimeframe) || '15m'
  );
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(!inside);
  const [error, setError] = useState<string | null>(null);

  const fetchStandalone = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await loadMarketData(symbol, standaloneTf));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch market data');
    } finally {
      setLoading(false);
    }
  }, [symbol, standaloneTf]);

  useEffect(() => {
    if (inside) return;
    void fetchStandalone();
  }, [inside, fetchStandalone]);

  const setTimeframe = useCallback((t: MarketTimeframe) => {
    setStandaloneTf(t);
  }, []);

  if (inside && ctx) {
    if (symbol !== ctx.marketSymbol) {
      throw new Error(
        `useMarketData: symbol "${symbol}" does not match V3DashboardDataProvider marketSymbol "${ctx.marketSymbol}".`
      );
    }
    return {
      ...ctx.market,
      timeframe: ctx.marketTimeframe,
      setTimeframe: ctx.setMarketTimeframe,
    };
  }

  return {
    data,
    loading,
    error,
    refresh: fetchStandalone,
    timeframe: standaloneTf,
    setTimeframe,
  };
}
