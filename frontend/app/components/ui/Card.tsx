import { cn } from '@/lib/utils';

interface CardProps {
  children?: React.ReactNode;
  className?: string;
  glow?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ children, className, glow = false, padding = 'md' }: CardProps) {
  return (
    <div
      className={cn(
        'bg-bg-secondary border border-border-default rounded-xl min-w-0',
        'shadow-card',
        'transition-[border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        'hover:border-border-strong hover:shadow-card-hover',
        glow && 'animate-pulse-glow',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4 sm:p-5',
        padding === 'lg' && 'p-5 sm:p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, icon, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {icon && (
          <span className="text-accent-primary flex-shrink-0 p-1.5 rounded-lg bg-accent-primary/10">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold tracking-tight text-foreground truncate">{title}</h3>
          {subtitle && (
            <p className="text-xs text-foreground-tertiary truncate mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
