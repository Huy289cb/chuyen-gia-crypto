import { cn } from '@/lib/utils';

interface PanelStatProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}

export function PanelStat({ label, children, className, accent = false }: PanelStatProps) {
  return (
    <div className={cn('panel-stat', accent && 'panel-stat-accent', className)}>
      <p className="text-xs font-medium text-foreground-tertiary mb-1.5">{label}</p>
      {children}
    </div>
  );
}

interface PanelRowProps {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}

export function PanelRow({ children, className, interactive = false }: PanelRowProps) {
  return (
    <div className={cn('panel-row', interactive && 'panel-row-interactive', className)}>
      {children}
    </div>
  );
}
