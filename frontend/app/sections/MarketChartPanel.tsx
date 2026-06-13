'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { TimeframeSwitcher } from '../components/TimeframeSwitcher';
import { ChartToolbar } from '../components/ChartToolbar';
import { PriceChart } from '../components/crypto/PriceChart';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
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

  const chartData: ChartDataPoint[] = normalizeChartCandles(marketData?.candles || []);

  return (
    <Card className={cn('min-w-0', className)}>
      <SectionHeader
        title="Market Chart"
        subtitle={`${symbol} · ${timeframe}`}
        icon={<TrendingUp className="w-5 h-5" />}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TimeframeSwitcher value={timeframe} onChange={setTimeframe} />
            <ChartToolbar onRefresh={refresh} isRefreshing={loading} />
          </div>
        }
      />

      <div className="relative h-[300px] min-w-0 rounded-lg border border-border-default/60 bg-surface-1/30 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
            <LoadingSkeleton variant="text" width="40%" />
            <p className="text-xs text-foreground-tertiary">Loading chart data…</p>
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
          <EmptyState
            icon={TrendingUp}
            title="No chart data"
            description="Market candles are not available for this timeframe yet."
            size="sm"
          />
        )}
      </div>
    </Card>
  );
}
