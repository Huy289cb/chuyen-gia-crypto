import { cn } from '@/lib/utils';

interface BadgeProps {
  children?: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'info' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Badge({ 
  children, 
  variant = 'default', 
  size = 'sm',
  className 
}: BadgeProps) {
  const variants: Record<string, string> = {
    default: 'bg-accent-primary/15 text-accent-primary border-accent-primary/20',
    success: 'bg-success-dim text-success border-success/20',
    danger: 'bg-danger-dim text-danger border-danger/20',
    warning: 'bg-warning-dim text-warning border-warning/20',
    info: 'bg-info-dim text-info border-info/20',
    neutral: 'bg-surface-2 text-foreground-secondary border-border-default',
  };

  const sizes: Record<string, string> = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-sm',
  };

  const variantClass = variants[variant] || variants['default'];
  const sizeClass = sizes[size] || sizes['sm'];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium rounded-full border',
        variantClass,
        sizeClass,
        className
      )}
    >
      {children}
    </span>
  );
}
