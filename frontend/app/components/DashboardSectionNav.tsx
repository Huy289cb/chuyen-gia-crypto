'use client';

import { cn } from '@/lib/utils';

export type DashboardSectionId =
  | 'overview'
  | 'market'
  | 'execution'
  | 'pipeline'
  | 'system';

const SECTIONS: { id: DashboardSectionId; label: string }[] = [
  { id: 'overview', label: 'Tóm tắt' },
  { id: 'market', label: 'Thị trường' },
  { id: 'execution', label: 'Thực thi' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'system', label: 'Hệ thống' },
];

interface DashboardSectionNavProps {
  activeSection?: DashboardSectionId;
  className?: string;
}

export function DashboardSectionNav({ activeSection, className }: DashboardSectionNavProps) {
  return (
    <nav
      aria-label="Dashboard sections"
      className={cn(
        'sticky top-14 sm:top-16 z-40 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2',
        'bg-bg-primary/90 backdrop-blur-md border-b border-border-default/60',
        className
      )}
    >
      <div className="flex gap-1 overflow-x-auto scrollbar-hide max-w-[90rem] mx-auto">
        {SECTIONS.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200',
              'border border-transparent',
              activeSection === id
                ? 'bg-accent-primary/15 text-accent-primary border-accent-primary/25'
                : 'text-foreground-secondary hover:text-foreground hover:bg-surface-1'
            )}
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
