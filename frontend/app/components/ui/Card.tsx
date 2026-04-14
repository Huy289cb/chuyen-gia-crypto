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
        'bg-bg-secondary border border-border-default rounded-xl',
        'transition-all duration-300',
        'hover:border-border-strong',
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
      <div className="flex items-center gap-2">
        {icon && <span className="text-accent-primary">{icon}</span>}
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-foreground-tertiary">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
