'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TradingAccount, Position, Trade, ApiResponse, PaperTradingData } from '@/app/types';

const API_BASE = process.env.NODE_ENV === 'development'
  ? 'http://localhost:3000/api'
  : '/api';

export function usePaperTrading(method: string = 'kim_nghia') {
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [equityCurve, setEquityCurve] = useState<any[]>([]);
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

  const fetchTradeHistory = useCallback(async (limit = 10, page = 1) => {
    try {
      const response = await fetch(`${API_BASE}/performance/trades?symbol=BTC&limit=${limit}&page=${page}&method=${method}`);
      const data: ApiResponse<Trade[]> = await response.json();
      if (data.success && data.data) {
        setTradeHistory(data.data);
      }
    } catch (err) {
      console.error('Error fetching trade history:', err);
    }
  }, [method]);

  const fetchEquityCurve = useCallback(async (limit = 100) => {
    try {
      const response = await fetch(`${API_BASE}/performance/equity-curve?symbol=BTC&limit=${limit}&method=${method}`);
      const data: ApiResponse<any[]> = await response.json();
      if (data.success && data.data) {
        setEquityCurve(data.data);
      }
    } catch (err) {
      console.error('Error fetching equity curve:', err);
    }
  }, [method]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Clear state before fetching new data to prevent race condition
    setAccounts([]);
    setPositions([]);
    setTradeHistory([]);
    setEquityCurve([]);
    try {
      await Promise.all([fetchAccounts(), fetchPositions(), fetchTradeHistory(), fetchEquityCurve()]);
    } catch (err) {
      setError('Failed to fetch paper trading data');
    } finally {
      setLoading(false);
    }
  }, [fetchAccounts, fetchPositions, fetchTradeHistory, fetchEquityCurve]);

  useEffect(() => {
    fetchData();
    // Refresh every 1 minute (with 1-minute candle data)
    const interval = setInterval(fetchData, 60000);
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
    equityCurve,
    loading,
    error,
    refresh: fetchData,
    resetAccount,
    closePosition
  };
}
