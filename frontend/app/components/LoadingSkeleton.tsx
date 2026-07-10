import { cn } from '@/lib/utils';

interface LoadingSkeletonProps {
  className?: string;
  variant?: 'text' | 'card' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  count?: number;
}

export function LoadingSkeleton({
  className,
  variant = 'text',
  width,
  height,
  count = 1,
}: LoadingSkeletonProps) {
  const variantClasses = {
    text: 'h-4 rounded-md',
    card: 'rounded-xl',
    circular: 'rounded-full',
    rectangular: 'rounded-md',
  };

  const skeletons = Array.from({ length: count }).map((_, i) => (
    <div
      key={i}
      className={cn('skeleton-shimmer', variantClasses[variant], className)}
      style={{ width, height }}
    />
  ));

  return <>{skeletons}</>;
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('p-4 sm:p-5 border border-border-default rounded-xl shadow-card', className)}>
      <LoadingSkeleton variant="text" width="40%" className="mb-3" />
      <LoadingSkeleton variant="text" width="70%" className="mb-2" />
      <LoadingSkeleton variant="text" width="50%" />
    </div>
  );
}

export function MetricSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('p-4 border border-border-default rounded-xl shadow-card', className)}>
      <LoadingSkeleton variant="text" width="30%" className="mb-2.5" />
      <LoadingSkeleton variant="text" width="60%" height="2rem" className="rounded-lg" />
    </div>
  );
}

export function TableSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-3 border border-border-default/60 rounded-lg bg-surface-1/30"
        >
          <LoadingSkeleton variant="circular" width={32} height={32} />
          <div className="flex-1 space-y-2">
            <LoadingSkeleton variant="text" width="40%" />
            <LoadingSkeleton variant="text" width="60%" />
          </div>
          <LoadingSkeleton variant="text" width={80} />
        </div>
      ))}
    </div>
  );
}
