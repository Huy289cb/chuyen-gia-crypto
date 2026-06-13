import { cn } from '@/lib/utils';

interface DashboardZoneProps {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function DashboardZone({ id, title, description, children, className }: DashboardZoneProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={cn('scroll-mt-24', className)}>
      <div className="mb-4 sm:mb-5">
        <h2
          id={`${id}-heading`}
          className="text-sm font-semibold tracking-tight text-foreground uppercase"
        >
          {title}
        </h2>
        {description && (
          <p className="text-xs text-foreground-tertiary mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}
