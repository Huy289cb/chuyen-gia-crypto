'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { TimeframeSwitcher } from '../components/TimeframeSwitcher';
import { ChartToolbar } from '../components/ChartToolbar';
import { PriceChart } from '../components/crypto/PriceChart';
import { TrendingUp } from 'lucide-react';
import { useMarketData } from '../hooks/useMarketData';
import { normalizeChartCandles } from '../lib/chartCandles';
import type { Prediction, Analysis } from '@/app/types';

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
  className,
}: MarketChartPanelProps) {
  const { data: marketData, loading, refresh, timeframe, setTimeframe } = useMarketData(symbol);

  const handleRefresh = () => {
    refresh();
  };

  const chartData: ChartDataPoint[] = normalizeChartCandles(marketData?.candles || []);

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
          <ChartToolbar onRefresh={handleRefresh} isRefreshing={loading} />
        </div>
      </div>

      <div className="h-[300px]">
        {loading ? (
          <div className="flex items-center justify-center h-full text-foreground-secondary">
            Loading chart data...
          </div>
        ) : chartData.length > 0 ? (
          <PriceChart
            key={timeframe}
            data={chartData}
            predictions={predictions}
            analysis={analysis}
            color={color}
            height={300}
            symbol={symbol}
            showPredictions={Boolean(predictions?.length)}
            timeframe={timeframe}
            method={method}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-foreground-secondary">
            No chart data available
          </div>
        )}
      </div>
    </Card>
  );
}
