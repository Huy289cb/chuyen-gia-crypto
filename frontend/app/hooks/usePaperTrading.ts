'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TradingAccount, Position, Trade, ApiResponse, PaperTradingData } from '@/app/types';

const API_BASE = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3000/api'
  : '/api';

export function usePaperTrading(method: string = 'ict') {
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/accounts?method=${method}`);
      const data: ApiResponse<TradingAccount[]> = await response.json();
      if (data.success && data.data) {
        setAccounts(data.data);
      }
    } catch (err) {
      console.error('Error fetching accounts:', err);
    }
  }, [method]);

  const fetchPositions = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/positions?status=open&method=${method}`);
      const data: ApiResponse<Position[]> = await response.json();
      if (data.success && data.data) {
        setPositions(data.data);
      }
    } catch (err) {
      console.error('Error fetching positions:', err);
    }
  }, [method]);

  const fetchTradeHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/performance/trades?symbol=BTC&method=${method}`);
      const data: ApiResponse<Trade[]> = await response.json();
      if (data.success && data.data) {
        setTradeHistory(data.data);
      }
    } catch (err) {
      console.error('Error fetching trade history:', err);
    }
  }, [method]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchAccounts(), fetchPositions(), fetchTradeHistory()]);
    } catch (err) {
      setError('Failed to fetch paper trading data');
    } finally {
      setLoading(false);
    }
  }, [fetchAccounts, fetchPositions, fetchTradeHistory]);

  useEffect(() => {
    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const resetAccount = useCallback(async (symbol: string) => {
    try {
      const response = await fetch(`${API_BASE}/accounts/reset/${symbol}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method })
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
  }, [fetchData, method]);

  const closePosition = useCallback(async (positionId: string, reason: string = 'manual') => {
    try {
      const response = await fetch(`${API_BASE}/positions/close/${positionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data: ApiResponse<Position> = await response.json();
      if (data.success) {
        await fetchData();
        return { success: true, data: data.data };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }, [fetchData]);

  return {
    accounts,
    positions,
    tradeHistory,
    loading,
    error,
    refresh: fetchData,
    resetAccount,
    closePosition
  };
}
