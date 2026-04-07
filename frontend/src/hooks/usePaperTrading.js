import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.API_URL || 'http://localhost:3000/api';

export function usePaperTrading() {
  const [accounts, setAccounts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAccounts = async () => {
    try {
      const response = await fetch(`${API_BASE}/accounts`);
      const data = await response.json();
      if (data.success) {
        setAccounts(data.data);
      }
    } catch (err) {
      console.error('Error fetching accounts:', err);
    }
  };

  const fetchPositions = async () => {
    try {
      const response = await fetch(`${API_BASE}/positions?status=open`);
      const data = await response.json();
      if (data.success) {
        setPositions(data.data);
      }
    } catch (err) {
      console.error('Error fetching positions:', err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchAccounts(), fetchPositions()]);
    } catch (err) {
      setError('Failed to fetch paper trading data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const resetAccount = async (symbol) => {
    try {
      const response = await fetch(`${API_BASE}/accounts/reset/${symbol}`, {
        method: 'POST'
      });
      const data = await response.json();
      if (data.success) {
        await fetchData();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const closePosition = async (positionId, reason = 'manual') => {
    try {
      const response = await fetch(`${API_BASE}/positions/close/${positionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await response.json();
      if (data.success) {
        await fetchData();
        return { success: true, data: data.data };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  return {
    accounts,
    positions,
    loading,
    error,
    refresh: fetchData,
    resetAccount,
    closePosition
  };
}
