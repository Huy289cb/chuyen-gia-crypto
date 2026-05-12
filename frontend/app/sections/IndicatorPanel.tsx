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
  timeframe?: string;
}

export function IndicatorPanel({ className, symbol = 'BTC', timeframe = '15m' }: IndicatorPanelProps) {
  const { data, loading, error } = useMarketData(symbol, timeframe);

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

  const indicatorList = [
    { name: 'SMA (50)', value: indicators.ma50 || 0, format: 'price' },
    { name: 'SMA (200)', value: indicators.ma200 || 0, format: 'price' },
    { name: 'RSI (14)', value: indicators.rsi || 50, format: 'number' },
    { name: 'MACD', value: indicators.macd || 0, format: 'number' },
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
          const value = indicator.format === 'price' ? formatPrice(indicator.value) : indicator.value.toFixed(2);
          const trend = indicator.name === 'RSI (14)'
            ? indicator.value > 70 ? 'down' : indicator.value < 30 ? 'up' : 'neutral'
            : indicator.value > 0 ? 'up' : indicator.value < 0 ? 'down' : 'neutral';

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
