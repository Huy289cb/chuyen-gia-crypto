import { useState, useEffect } from 'react';

const API_URL = import.meta.env.DEV
  ? 'http://localhost:3000/api'
  : '/api';

export function useTrends() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [historicalPredictions, setHistoricalPredictions] = useState({});

  const fetchData = async () => {
    try {
      const response = await fetch(`${API_URL}/analysis`);
      const result = await response.json();
      
      if (result.success) {
        setData(result.data);
        setError(null);
        
        // Fetch historical predictions for BTC and ETH
        fetchHistoricalPredictions('BTC');
        fetchHistoricalPredictions('ETH');
      } else {
        setError(result.message || 'Data not available');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistoricalPredictions = async (coin) => {
    try {
      const response = await fetch(`${API_URL}/predictions/${coin.toLowerCase()}?limit=50`);
      const result = await response.json();
      
      if (result.success) {
        setHistoricalPredictions(prev => ({
          ...prev,
          [coin]: result.data
        }));
      }
    } catch (err) {
      console.error(`Failed to fetch historical predictions for ${coin}:`, err);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 15 minutes
    const interval = setInterval(fetchData, 900000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading, error, refetch: fetchData, historicalPredictions };
}
