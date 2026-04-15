'use client';

import { useState, useEffect } from 'react';
import { PriceChart } from './PriceChart';
import { Card } from '../ui/Card';
import { BarChart3, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Prediction } from '@/app/types';

type TimeFrame = '15m' | '1h' | '4h' | '1d';

interface PriceChartContainerProps {
  symbol: string;
  predictions?: Prediction[];
  suggestedEntry?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface OHLCData {
  time: number;  // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
}

const TIMEFRAMES: { label: string; value: TimeFrame }[] = [
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
];

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
  const [timeframe, setTimeframe] = useState<TimeFrame>('4h');

  useEffect(() => {
    const fetchOHLC = async () => {
      try {
        setLoading(true);
        const API_BASE = process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3000/api' 
          : '/api';
        
        const response = await fetch(`${API_BASE}/ohlc/${symbol.toLowerCase()}?timeframe=${timeframe}&limit=100`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch chart data');
        }
        
        const result = await response.json();
        
        if (result.success && result.data) {
          // Data already in correct format with Unix timestamps
          const formattedData = result.data.map((candle: any) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          }));
          console.log('[PriceChart]', symbol, 'OHLC data points:', formattedData.length);
          console.log('[PriceChart]', symbol, 'First candle:', formattedData[0]);
          console.log('[PriceChart]', symbol, 'Last candle:', formattedData[formattedData.length - 1]);
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
  }, [symbol, timeframe]);

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
    <div className="space-y-2">
      {/* Timeframe Selector */}
      <div className="flex items-center justify-end gap-1">
        <div className="flex bg-surface-1 rounded-lg p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-all',
                timeframe === tf.value
                  ? 'bg-accent-primary text-bg-primary'
                  : 'text-foreground-secondary hover:text-foreground'
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      
      <PriceChart 
        data={data}
        predictions={predictions}
        suggestedEntry={suggestedEntry}
        stopLoss={stopLoss}
        takeProfit={takeProfit}
        height={300}
        symbol={symbol}
      />
    </div>
  );
}
