'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3000/api'
  : '/api';

export interface TestnetAccount {
  id: number;
  symbol: string;
  method_id: string;
  starting_balance: number;
  current_balance: number;
  equity: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  max_drawdown: number;
  consecutive_losses: number;
  last_trade_time: string | null;
  cooldown_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestnetPosition {
  id: number;
  position_id: string;
  account_id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  entry_time: string;
  status: 'open' | 'closed';
  size_usd: number;
  size_qty: number;
  risk_usd: number;
  risk_percent: number;
  expected_rr: number;
  realized_pnl: number;
  unrealized_pnl: number;
  close_price: number | null;
  close_time: string | null;
  close_reason: string | null;
  binance_order_id: string | null;
  binance_sl_order_id: string | null;
  binance_tp_order_id: string | null;
}

export interface TestnetPendingOrder {
  id: number;
  order_id: string;
  account_id: number;
  symbol: string;
  side: 'long' | 'short';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  size_usd: number;
  size_qty: number;
  risk_usd: number;
  risk_percent: number;
  expected_rr: number;
  linked_prediction_id: number | null;
  invalidation_level: number | null;
  status: 'pending' | 'executed' | 'cancelled';
  created_at: string;
  executed_at: string | null;
  executed_price: number | null;
  executed_size_qty: number | null;
  executed_size_usd: number | null;
  realized_pnl: number | null;
  realized_pnl_percent: number | null;
  close_reason: string | null;
  method_id: string;
  binance_order_id: string | null;
}

export interface TestnetPerformance {
  id: number;
  current_balance: number;
  equity: number;
  win_rate: number;
  profit_factor: number;
  total_return: number;
}

export interface TestnetSnapshot {
  id: number;
  account_id: number;
  balance: number;
  equity: number;
  unrealized_pnl: number;
  realized_pnl: number;
  open_positions_count: number;
  timestamp: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: any;
}

export function useTestnet() {
  const [account, setAccount] = useState<TestnetAccount | null>(null);
  const [positions, setPositions] = useState<TestnetPosition[]>([]);
  const [pendingOrders, setPendingOrders] = useState<TestnetPendingOrder[]>([]);
  const [performance, setPerformance] = useState<TestnetPerformance | null>(null);
  const [equityCurve, setEquityCurve] = useState<TestnetSnapshot[]>([]);
  const [tradeHistory, setTradeHistory] = useState<TestnetPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const hasFetchedInitial = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAccount = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/testnet/accounts`);
      const data: ApiResponse<TestnetAccount[]> = await response.json();
      if (data.success && data.data && data.data.length > 0) {
        setAccount(data.data[0]);
      }
    } catch (err) {
      console.error('Error fetching testnet account:', err);
    }
  }, []);

  const fetchPositions = useCallback(async (status?: string) => {
    try {
      const url = status 
        ? `${API_BASE}/testnet/positions?status=${status}`
        : `${API_BASE}/testnet/positions`;
      const response = await fetch(url);
      const data: ApiResponse<TestnetPosition[]> = await response.json();
      if (data.success && data.data) {
        setPositions(data.data);
      }
    } catch (err) {
      console.error('Error fetching testnet positions:', err);
    }
  }, []);

  const fetchPerformance = useCallback(async (accountId: number) => {
    try {
      const response = await fetch(`${API_BASE}/testnet/performance/${accountId}`);
      const data: ApiResponse<TestnetPerformance> = await response.json();
      if (data.success && data.data) {
        setPerformance(data.data);
      }
    } catch (err) {
      console.error('Error fetching testnet performance:', err);
    }
  }, []);

  const fetchEquityCurve = useCallback(async (accountId: number, limit = 100) => {
    try {
      const response = await fetch(`${API_BASE}/testnet/equity-curve/${accountId}?limit=${limit}`);
      const data: ApiResponse<TestnetSnapshot[]> = await response.json();
      if (data.success && data.data) {
        setEquityCurve(data.data);
      }
    } catch (err) {
      console.error('Error fetching equity curve:', err);
    }
  }, []);

  const fetchTradeHistory = useCallback(async (accountId: number, limit = 20) => {
    try {
      const response = await fetch(`${API_BASE}/testnet/trades/${accountId}?limit=${limit}`);
      const data: ApiResponse<TestnetPosition[]> = await response.json();
      if (data.success && data.data) {
        setTradeHistory(data.data);
      }
    } catch (err) {
      console.error('Error fetching trade history:', err);
    }
  }, []);

  const fetchPendingOrders = useCallback(async (status?: string) => {
    try {
      const url = status 
        ? `${API_BASE}/testnet/pending-orders?status=${status}`
        : `${API_BASE}/testnet/pending-orders`;
      const response = await fetch(url);
      const data: ApiResponse<TestnetPendingOrder[]> = await response.json();
      if (data.success && data.data) {
        setPendingOrders(data.data);
      }
    } catch (err) {
      console.error('Error fetching testnet pending orders:', err);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchAccount();
      await fetchPositions('open');
      await fetchPendingOrders('pending');
      if (account) {
        await fetchPerformance(account.id);
        await fetchEquityCurve(account.id);
        await fetchTradeHistory(account.id);
      }
    } catch (err) {
      setError('Failed to fetch testnet data');
    } finally {
      setLoading(false);
    }
  }, [fetchAccount, fetchPositions, fetchPendingOrders, fetchPerformance, fetchEquityCurve, fetchTradeHistory, account]);

  // Single useEffect for all data fetching with ref to prevent infinite loop
  useEffect(() => {
    const fetchAllData = async () => {
      setLoading(true);
      setError(null);
      try {
        await fetchAccount();
        await fetchPositions('open');
        await fetchPendingOrders('pending');
      } catch (err) {
        setError('Failed to fetch testnet data');
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Set up new interval
    intervalRef.current = setInterval(fetchAllData, 60000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchAccount, fetchPositions, fetchPendingOrders]);

  // Fetch account-dependent data when account is available
  useEffect(() => {
    if (!account) return;

    const fetchAccountDependentData = async () => {
      try {
        await fetchPerformance(account.id);
        await fetchEquityCurve(account.id);
        await fetchTradeHistory(account.id);
      } catch (err) {
        console.error('Error fetching account-dependent data:', err);
      }
    };

    fetchAccountDependentData();

    // Set up separate interval for account-dependent data
    const interval = setInterval(fetchAccountDependentData, 60000);
    return () => clearInterval(interval);
  }, [account, fetchPerformance, fetchEquityCurve, fetchTradeHistory]);

  const syncAccount = useCallback(async () => {
    if (!account) return { success: false, error: 'No account found' };
    
    setSyncing(true);
    try {
      const response = await fetch(`${API_BASE}/testnet/sync/${account.id}`);
      const data: ApiResponse<any> = await response.json();
      
      if (data.success) {
        setLastSyncTime(new Date().toISOString());
        await fetchData();
        return { success: true, data: data.data };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    } finally {
      setSyncing(false);
    }
  }, [account, fetchData]);

  const resetAccount = useCallback(async () => {
    if (!account) return { success: false, error: 'No account found' };
    
    try {
      const response = await fetch(`${API_BASE}/testnet/reset/${account.id}`, {
        method: 'POST',
      });
      const data: ApiResponse<void> = await response.json();
      
      if (data.success) {
        await fetchData();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }, [account, fetchData]);

  const closePosition = useCallback(async (positionId: string) => {
    try {
      const response = await fetch(`${API_BASE}/testnet/positions/${positionId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      });
      const data: ApiResponse<TestnetPosition> = await response.json();
      
      if (data.success) {
        await fetchData();
        return { success: true, data: data.data };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }, [fetchData]);

  const cancelPendingOrder = useCallback(async (orderId: string) => {
    try {
      const response = await fetch(`${API_BASE}/testnet/pending-orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      });
      const data: ApiResponse<void> = await response.json();
      
      if (data.success) {
        await fetchData();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }, [fetchData]);

  return {
    account,
    positions,
    pendingOrders,
    performance,
    equityCurve,
    tradeHistory,
    loading,
    error,
    syncing,
    lastSyncTime,
    refresh: fetchData,
    syncAccount,
    resetAccount,
    closePosition,
    cancelPendingOrder,
  };
}
