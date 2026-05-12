import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ 
  title, 
  subtitle, 
  icon, 
  action, 
  badge,
  className 
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {icon && <span className="text-accent-primary flex-shrink-0">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground truncate">{title}</h3>
            {badge}
          </div>
          {subtitle && <p className="text-xs text-foreground-tertiary truncate mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
