'use client';

import { cn } from '@/lib/utils';

type TimeFrame = '15m' | '1h' | '4h' | '1d';

interface TimeframeSwitcherProps {
  value: TimeFrame;
  onChange: (value: TimeFrame) => void;
  className?: string;
}

const TIMEFRAMES: { label: string; value: TimeFrame }[] = [
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
