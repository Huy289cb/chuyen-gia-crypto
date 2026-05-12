'use client';

import { useState, useEffect } from 'react';

interface AccountData {
  balance: {
    totalBalance: number;
    availableBalance: number;
    equity: number;
    usedMargin: number;
    freeMargin: number;
    dailyPnL: number;
    weeklyPnL: number;
  };
  positions: Array<{
    id: string;
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnL: number;
    pnlPercentage: string;
    stopLoss: number;
    takeProfit: number;
    timeInPosition: string;
  }>;
  orders: Array<{
    id: string;
    symbol: string;
    side: string;
    type: string;
    status: string;
    price: number;
    quantity: number;
    reduceOnly: boolean;
    createdAt: string;
  }>;
  trades: Array<{
    id: string;
    symbol: string;
    side: string;
    price: number;
    quantity: number;
    fee: number;
    realizedPnL: number;
    status: string;
    closedAt: string;
  }>;
}

interface UseAccountDataReturn {
  data: AccountData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAccountData(): UseAccountDataReturn {
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [balanceResponse, positionsResponse, ordersResponse, tradesResponse] = await Promise.all([
        fetch('/api/account/balance?symbol=BTC&method=kim_nghia'),
        fetch('/api/account/positions?symbol=BTC&method=kim_nghia'),
        fetch('/api/account/orders?symbol=BTC&method=kim_nghia'),
        fetch('/api/account/trades?symbol=BTC&method=kim_nghia&limit=20'),
      ]);

      const balanceData = await balanceResponse.json();
      const positionsData = await positionsResponse.json();
      const ordersData = await ordersResponse.json();
      const tradesData = await tradesResponse.json();

      setData({
        balance: balanceData.data || null,
        positions: positionsData.data || [],
        orders: ordersData.data || [],
        trades: tradesData.data || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch account data');
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
