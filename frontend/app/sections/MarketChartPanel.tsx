'use client';

import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { TimeframeSwitcher } from '../components/TimeframeSwitcher';
import { ChartToolbar } from '../components/ChartToolbar';
import { PriceChart } from '../components/crypto/PriceChart';
import { TrendingUp } from 'lucide-react';
import type { Prediction, Analysis } from '@/app/types';

type TimeFrame = '15m' | '1h' | '4h' | '1d';

interface MarketChartPanelProps {
  symbol?: string;
  predictions?: Prediction[];
  analysis?: Analysis;
  color?: string;
  method?: string;
  className?: string;
}

interface ChartDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function MarketChartPanel({ 
  symbol = 'BTC',
  predictions,
  analysis,
  color = '#f7931a',
  method = 'kim_nghia',
  className 
}: MarketChartPanelProps) {
  const [timeframe, setTimeframe] = useState<TimeFrame>('15m');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [data, setData] = useState<ChartDataPoint[]>([]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const API_BASE = process.env.NODE_ENV === 'development' 
        ? 'http://localhost:3000/api' 
        : '/api';
      
      const response = await fetch(`${API_BASE}/ohlc/${symbol.toLowerCase()}?timeframe=${timeframe}&limit=100`);
      
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const formattedData = result.data.map((candle: any) => ({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          }));
          setData(formattedData);
        }
      }
    } catch (error) {
      console.error('Error refreshing chart:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Card className={className}>
      <div className="flex items-center justify-between mb-4">
        <SectionHeader
          title="Market Chart"
          subtitle={`${symbol} ${timeframe}`}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <div className="flex items-center gap-3">
          <TimeframeSwitcher value={timeframe} onChange={setTimeframe} />
          <ChartToolbar onRefresh={handleRefresh} isRefreshing={isRefreshing} />
        </div>
      </div>
      
      <div className="h-[300px]">
        {data.length > 0 ? (
          <PriceChart 
            data={data}
            predictions={predictions}
            analysis={analysis}
            color={color}
            height={300}
            symbol={symbol}
            showPredictions={true}
            timeframe={timeframe}
            method={method}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-foreground-secondary">
            Loading chart data...
          </div>
        )}
      </div>
    </Card>
  );
}
