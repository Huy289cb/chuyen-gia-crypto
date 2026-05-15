'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { Activity } from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { useMarketData } from '../hooks/useMarketData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface IndicatorPanelProps {
  className?: string;
  symbol?: string;
}

/** Uses the same market timeframe as `MarketChartPanel` when wrapped in `V3DashboardDataProvider`. */
export function IndicatorPanel({ className, symbol = 'BTC' }: IndicatorPanelProps) {
  const { data, loading, error } = useMarketData(symbol);

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Indicators"
          subtitle="Loading..."
          icon={<Activity className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error || !data?.indicators) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Indicators"
          subtitle="Error loading data"
          icon={<Activity className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-red-500">{error || 'Failed to load indicator data'}</div>
      </Card>
    );
  }

  const indicators = data.indicators;

  const fmt = (v: number | null, kind: 'price' | 'number') => {
    if (v === null || Number.isNaN(v)) return '—';
    return kind === 'price' ? formatPrice(v) : v.toFixed(2);
  };

  const indicatorList = [
    { name: 'SMA (20)', value: indicators.sma20, format: 'price' as const },
    { name: 'SMA (50)', value: indicators.sma50, format: 'price' as const },
    { name: 'RSI (14)', value: indicators.rsi14, format: 'number' as const },
    { name: 'ATR (14)', value: indicators.atr14, format: 'number' as const },
  ];

  return (
    <Card className={className}>
      <SectionHeader
        title="Indicators"
        subtitle="Technical analysis overlays"
        icon={<Activity className="w-5 h-5" />}
      />

      <div className="space-y-3">
        {indicatorList.map((indicator) => {
          const numeric = indicator.value;
          const value = fmt(numeric, indicator.format);
          const trend =
            indicator.name === 'RSI (14)' && numeric !== null
              ? numeric > 70
                ? 'down'
                : numeric < 30
                  ? 'up'
                  : 'neutral'
              : numeric !== null && numeric > 0
                ? 'up'
                : numeric !== null && numeric < 0
                  ? 'down'
                  : 'neutral';

          return (
            <div
              key={indicator.name}
              className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg"
            >
              <span className="text-sm text-foreground-secondary">{indicator.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-foreground">{value}</span>
                <span className={cn(
                  'text-xs',
                  trend === 'up' ? 'text-success' :
                  trend === 'down' ? 'text-danger' : 'text-foreground-tertiary'
                )}>
                  {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '•'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
