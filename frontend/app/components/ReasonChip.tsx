'use client';

import { cn } from '@/lib/utils';

interface ReasonChipProps {
  label: string;
  count?: number;
  variant?: 'default' | 'warning' | 'danger' | 'info';
  className?: string;
}

export function ReasonChip({ label, count, variant = 'default', className }: ReasonChipProps) {
  const variants = {
    default: 'bg-surface-2 text-foreground-secondary border-border-default',
    warning: 'bg-warning-dim text-warning border-warning/20',
    danger: 'bg-danger-dim text-danger border-danger/20',
    info: 'bg-info-dim text-info border-info/20',
  };

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
      variants[variant],
      className
    )}>
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="bg-bg-primary/50 px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
          {count}
        </span>
      )}
    </div>
  );
}
