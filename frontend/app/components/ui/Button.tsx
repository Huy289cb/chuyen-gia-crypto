import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary:
      'bg-accent-primary hover:bg-accent-secondary text-bg-primary font-medium shadow-sm hover:shadow-md active:scale-[0.98]',
    secondary:
      'bg-surface-1 hover:bg-surface-2 text-foreground border border-border-default hover:border-border-strong active:scale-[0.98]',
    ghost:
      'hover:bg-surface-1 text-foreground-secondary hover:text-foreground active:scale-[0.98]',
    danger:
      'bg-danger-dim hover:bg-danger/25 text-danger border border-danger/20 active:scale-[0.98]',
  };

  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };

  const variantClass = variants[variant] || variants['primary'];
  const sizeClass = sizes[size] || sizes['md'];

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg',
        'transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        variantClass,
        sizeClass,
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
      {!isLoading && leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
}
