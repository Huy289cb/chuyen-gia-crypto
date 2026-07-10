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
        'text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider',
        isLong
          ? 'bg-success/15 text-success border border-success/20'
          : 'bg-danger/15 text-danger border border-danger/20',
        className
      )}
    >
      {side}
    </span>
  );
}
