import { cn } from '@/lib/utils';
import { Card } from './ui/Card';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
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
        <p className="text-xs text-foreground-tertiary uppercase tracking-wide mb-1">{title}</p>
        <p className={cn('font-mono font-semibold truncate', valueSizeClasses[size], 'text-foreground')}>
          {value}
        </p>
        {change !== undefined && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-1">
            <span className={cn('text-xs font-medium', getTrendColor())}>
              {getTrendIcon()} {change > 0 ? '+' : ''}{change}%
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
          'bg-surface-1/50 rounded-lg border border-border-default/60',
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
