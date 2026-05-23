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
    <div className={cn('flex bg-surface-1 rounded-lg p-1', className)}>
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          onClick={() => onChange(tf.value)}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md transition-all',
            value === tf.value
              ? 'bg-accent-primary text-bg-primary'
              : 'text-foreground-secondary hover:text-foreground'
          )}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
