'use client';

import { cn } from '@/lib/utils';
import type { MarketTimeframe } from '../contexts/V3DashboardDataContext';

interface TimeframeSwitcherProps {
  value: MarketTimeframe;
  onChange: (value: MarketTimeframe) => void;
  className?: string;
}

const TIMEFRAMES: { label: string; value: MarketTimeframe }[] = [
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
];

export function TimeframeSwitcher({ value, onChange, className }: TimeframeSwitcherProps) {
  return (
    <div
      className={cn(
        'inline-flex bg-surface-1/80 rounded-lg p-0.5 border border-border-default/60',
        className
      )}
      role="tablist"
      aria-label="Chart timeframe"
    >
      {TIMEFRAMES.map((tf) => {
        const active = value === tf.value;
        return (
          <button
            key={tf.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tf.value)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50',
              active
                ? 'bg-accent-primary text-bg-primary shadow-sm'
                : 'text-foreground-secondary hover:text-foreground hover:bg-surface-2/80'
            )}
          >
            {tf.label}
          </button>
        );
      })}
    </div>
  );
}
