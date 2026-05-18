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
  size = 'md'
}: EmptyStateProps) {
  const sizeClasses = {
    sm: 'py-6 px-4',
    md: 'py-8 px-6',
    lg: 'py-12 px-8'
  };

  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };

  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center min-h-[120px]',
      sizeClasses[size],
      className
    )}>
      {Icon && (
        <div className={cn('text-foreground-tertiary mb-4', iconSizes[size])}>
          <Icon className="w-full h-full" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-foreground-secondary mb-4 max-w-md">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
