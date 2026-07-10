import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = 'md',
}: EmptyStateProps) {
  const sizeClasses = {
    sm: 'py-6 px-4',
    md: 'py-8 px-6',
    lg: 'py-12 px-8',
  };

  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };

  const iconWrapSizes = {
    sm: 'w-12 h-12',
    md: 'w-14 h-14',
    lg: 'w-16 h-16',
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center min-h-[120px]',
        sizeClasses[size],
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-2xl bg-surface-1 border border-border-default mb-4',
            iconWrapSizes[size]
          )}
        >
          <Icon className={cn('text-foreground-tertiary', iconSizes[size])} />
        </div>
      )}
      <h3 className="text-base font-semibold tracking-tight text-foreground mb-1.5 text-balance">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-foreground-secondary mb-4 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
