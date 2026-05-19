import { cn } from '@/lib/utils';

interface SideChipProps {
  side: string;
  className?: string;
}

export function SideChip({ side, className }: SideChipProps) {
  const normalized = side.toLowerCase();
  const isLong = normalized === 'long' || normalized === 'buy';

  return (
    <span
      className={cn(
        'text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide',
        isLong ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
        className
      )}
    >
      {side}
    </span>
  );
}
