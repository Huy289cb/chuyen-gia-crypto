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
}

export function MetricCard({ 
  title, 
  value, 
  change, 
  changeLabel,
  icon, 
  trend = 'neutral',
  className,
  size = 'md'
}: MetricCardProps) {
  const sizeClasses = {
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5'
  };

  const valueSizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl'
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

  return (
    <Card className={cn(sizeClasses[size], className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground-tertiary uppercase tracking-wide mb-1">{title}</p>
          <p className={cn('font-mono font-semibold', valueSizeClasses[size], 'text-foreground truncate')}>
            {value}
          </p>
          {change !== undefined && (
            <div className="flex items-center gap-1 mt-1">
              <span className={cn('text-xs font-medium', getTrendColor())}>
                {getTrendIcon()} {change > 0 ? '+' : ''}{change}%
              </span>
              {changeLabel && <span className="text-xs text-foreground-tertiary">{changeLabel}</span>}
            </div>
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0 ml-3 text-accent-primary/60">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
