'use client';

import { useState, useEffect } from 'react';
import { PriceChart } from './PriceChart';
import { Card } from '../ui/Card';
import { BarChart3, Loader2 } from 'lucide-react';
import type { Prediction } from '@/app/types';

interface PriceChartContainerProps {
  symbol: string;
  predictions?: Prediction[];
  suggestedEntry?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface OHLCData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function PriceChartContainer({ 
  symbol, 
  predictions,
  suggestedEntry,
  stopLoss,
  takeProfit 
}: PriceChartContainerProps) {
  const [data, setData] = useState<OHLCData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOHLC = async () => {
      try {
        setLoading(true);
        const API_BASE = process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3000/api' 
          : '/api';
        
        const response = await fetch(`${API_BASE}/ohlc/${symbol.toLowerCase()}?timeframe=4h&limit=100`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch chart data');
        }
        
        const result = await response.json();
        
        if (result.success && result.data) {
          // Convert timestamp to string format for lightweight-charts
          const formattedData = result.data.map((candle: any) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          }));
          setData(formattedData);
        } else {
          throw new Error(result.message || 'No data available');
        }
      } catch (err) {
        console.error('Error fetching OHLC data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load chart');
      } finally {
        setLoading(false);
      }
    };

    fetchOHLC();
  }, [symbol]);

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-center gap-2 text-foreground-secondary h-[300px]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading chart...</span>
        </div>
      </Card>
    );
  }

  if (error || data.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex flex-col items-center justify-center text-foreground-secondary h-[300px]">
          <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-sm">{error || 'No chart data available'}</span>
        </div>
      </Card>
    );
  }

  return (
    <PriceChart 
      data={data}
      predictions={predictions}
      suggestedEntry={suggestedEntry}
      stopLoss={stopLoss}
      takeProfit={takeProfit}
      height={300}
    />
  );
}
