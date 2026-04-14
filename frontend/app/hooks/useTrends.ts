'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TrendsData, ApiResponse } from '@/app/types';

const API_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:3000/api' 
  : '/api';

export function useTrends() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/analysis`);
      const result: ApiResponse<TrendsData> = await response.json();
      
      if (result.success && result.data) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.message || 'Data not available');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 15 minutes
    const interval = setInterval(fetchData, 900000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { 
    data, 
    loading, 
    error, 
    refetch: fetchData 
  };
}
