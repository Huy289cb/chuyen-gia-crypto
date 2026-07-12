'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  loadDashboardSummary,
  loadDashboardScope,
  loadAccountData,
  loadIntelligenceData,
  loadMarketData,
  type DashboardSummaryData,
  type DashboardScopeData,
  type AccountData,
  type IntelligenceData,
  type DashboardMarketData,
} from '../lib/v3DashboardFetchers';

export type MarketTimeframe = '5m' | '15m' | '1h' | '4h' | '1d';

type SummarySlice = {
  data: DashboardSummaryData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

type AccountSlice = {
  data: AccountData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

type IntelligenceSlice = {
  data: IntelligenceData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

type MarketSlice = {
  data: DashboardMarketData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export type V3DashboardContextValue = {
  summary: SummarySlice;
  account: AccountSlice;
  intelligence: IntelligenceSlice;
  market: MarketSlice;
  marketSymbol: string;
  enabledSymbols: string[];
  setMarketSymbol: (symbol: string) => void;
  marketTimeframe: MarketTimeframe;
  setMarketTimeframe: (tf: MarketTimeframe) => void;
};

export const V3DashboardDataContext = createContext<V3DashboardContextValue | null>(null);

export function V3DashboardDataProvider({
  children,
  marketSymbol = 'BTC',
}: {
  children: ReactNode;
  marketSymbol?: string;
}) {
  const [selectedSymbol, setSelectedSymbol] = useState(marketSymbol.toUpperCase());
  const [scopeData, setScopeData] = useState<DashboardScopeData | null>(null);
  const [summaryData, setSummaryData] = useState<DashboardSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    try {
      setSummaryLoading(true);
      setSummaryError(null);
      const [summary, scope] = await Promise.all([loadDashboardSummary(), loadDashboardScope()]);
      setSummaryData(summary);
      setScopeData(scope);
      if (!scope.enabledSymbols.includes(selectedSymbol)) {
        setSelectedSymbol(scope.enabledSymbols[0] ?? 'BTC');
      }
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Failed to fetch dashboard summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedSymbol]);

  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);

  const refreshAccount = useCallback(async () => {
    try {
      setAccountLoading(true);
      setAccountError(null);
      setAccountData(await loadAccountData(selectedSymbol));
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : 'Failed to fetch account data');
    } finally {
      setAccountLoading(false);
    }
  }, [selectedSymbol]);

  const [intelData, setIntelData] = useState<IntelligenceData | null>(null);
  const [intelLoading, setIntelLoading] = useState(true);
  const [intelError, setIntelError] = useState<string | null>(null);

  const refreshIntel = useCallback(async () => {
    try {
      setIntelLoading(true);
      setIntelError(null);
      setIntelData(await loadIntelligenceData(selectedSymbol));
    } catch (e) {
      setIntelError(e instanceof Error ? e.message : 'Failed to fetch intelligence data');
    } finally {
      setIntelLoading(false);
    }
  }, [selectedSymbol]);

  const [marketTimeframe, setMarketTimeframe] = useState<MarketTimeframe>('15m');
  const [marketData, setMarketData] = useState<DashboardMarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);

  const refreshMarket = useCallback(async () => {
    try {
      setMarketLoading(true);
      setMarketError(null);
      setMarketData(await loadMarketData(selectedSymbol, marketTimeframe));
    } catch (e) {
      setMarketError(e instanceof Error ? e.message : 'Failed to fetch market data');
    } finally {
      setMarketLoading(false);
    }
  }, [selectedSymbol, marketTimeframe]);

  const setMarketSymbol = useCallback((symbol: string) => {
    const normalized = symbol.toUpperCase();
    setSelectedSymbol(normalized);
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  /** Refresh balance/positions/orders on an interval (mark & unrealized PnL). */
  useEffect(() => {
    const intervalMs = 120_000;
    const id = setInterval(() => {
      void refreshAccount();
    }, intervalMs);
    return () => clearInterval(id);
  }, [refreshAccount]);

  useEffect(() => {
    void refreshIntel();
  }, [refreshIntel]);

  useEffect(() => {
    void refreshMarket();
  }, [refreshMarket]);

  const value = useMemo<V3DashboardContextValue>(
    () => ({
      summary: {
        data: summaryData,
        loading: summaryLoading,
        error: summaryError,
        refresh: refreshSummary,
      },
      account: {
        data: accountData,
        loading: accountLoading,
        error: accountError,
        refresh: refreshAccount,
      },
      intelligence: {
        data: intelData,
        loading: intelLoading,
        error: intelError,
        refresh: refreshIntel,
      },
      market: {
        data: marketData,
        loading: marketLoading,
        error: marketError,
        refresh: refreshMarket,
      },
      marketSymbol: selectedSymbol,
      enabledSymbols: scopeData?.enabledSymbols ?? [selectedSymbol],
      setMarketSymbol,
      marketTimeframe,
      setMarketTimeframe,
    }),
    [
      summaryData,
      summaryLoading,
      summaryError,
      refreshSummary,
      accountData,
      accountLoading,
      accountError,
      refreshAccount,
      intelData,
      intelLoading,
      intelError,
      refreshIntel,
      marketData,
      marketLoading,
      marketError,
      refreshMarket,
      selectedSymbol,
      scopeData,
      setMarketSymbol,
      marketTimeframe,
    ]
  );

  return <V3DashboardDataContext.Provider value={value}>{children}</V3DashboardDataContext.Provider>;
}

export function useV3Dashboard(): V3DashboardContextValue {
  const ctx = useContext(V3DashboardDataContext);
  if (!ctx) {
    throw new Error('useV3Dashboard must be used within V3DashboardDataProvider');
  }
  return ctx;
}
