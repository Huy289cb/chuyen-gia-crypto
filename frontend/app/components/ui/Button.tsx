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
      'bg-accent-primary hover:bg-accent-secondary text-bg-primary font-medium',
    secondary: 
      'bg-surface-1 hover:bg-surface-2 text-foreground border border-border-default hover:border-border-strong',
    ghost: 
      'hover:bg-surface-1 text-foreground-secondary hover:text-foreground',
    danger: 
      'bg-danger-dim hover:bg-danger/25 text-danger border border-danger/20',
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
        'transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
        'disabled:opacity-50 disabled:cursor-not-allowed',
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
