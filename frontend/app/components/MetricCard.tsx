import { cn, formatPercentage } from '@/lib/utils';
import { Card } from './ui/Card';

interface MetricCardProps {
  title: string;
  value: string | number;
  /** Percentage delta (rendered with formatPercentage) */
  change?: number;
  changeLabel?: string;
  /** Plain-text subline (e.g. unrealized PnL in USD) — preferred over change when both could apply */
  footnote?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Use inside another Card to avoid double border/padding */
  nested?: boolean;
}

export function MetricCard({
  title,
  value,
  change,
  changeLabel,
  footnote,
  icon,
  trend = 'neutral',
  className,
  size = 'md',
  nested = false,
}: MetricCardProps) {
  const sizeClasses = {
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5',
  };

  const valueSizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
  };

  const getTrendColor = () => {
    if (trend === 'up') return 'text-success';
    if (trend === 'down') return 'text-danger';
    return 'text-foreground-secondary';
  };

  const getTrendIcon = () => {
    if (trend === 'up') return '↑';
    if (trend === 'down') return '↓';
    return '•';
  };

  const content = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground-tertiary font-medium tracking-wide mb-1.5">{title}</p>
        <p className={cn('font-mono font-semibold tabular-nums truncate tracking-tight', valueSizeClasses[size], 'text-foreground')}>
          {value}
        </p>
        {footnote && (
          <p className={cn('text-xs font-medium mt-1', getTrendColor())}>{footnote}</p>
        )}
        {!footnote && change !== undefined && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-1">
            <span className={cn('text-xs font-medium', getTrendColor())}>
              {getTrendIcon()} {formatPercentage(change)}
            </span>
            {changeLabel && (
              <span className="text-xs text-foreground-tertiary">{changeLabel}</span>
            )}
          </div>
        )}
      </div>
      {icon && (
        <div className="flex-shrink-0 text-accent-primary/60">{icon}</div>
      )}
    </div>
  );

  if (nested) {
    return (
      <div
        className={cn(
          'panel-stat',
          sizeClasses[size],
          className
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <Card className={cn(sizeClasses[size], className)}>
      {content}
    </Card>
  );
}
