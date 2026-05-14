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

async function readAccountJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return body;
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

      const [balanceData, positionsData, ordersData, tradesData] = await Promise.all([
        readAccountJson(balanceResponse),
        readAccountJson(positionsResponse),
        readAccountJson(ordersResponse),
        readAccountJson(tradesResponse),
      ]);

      setData({
        balance: balanceData.data ?? {
          totalBalance: 0,
          availableBalance: 0,
          equity: 0,
          usedMargin: 0,
          freeMargin: 0,
          dailyPnL: 0,
          weeklyPnL: 0,
        },
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
