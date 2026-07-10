'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { EventLogItem } from '../components/EventLogItem';
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, formatVietnamTime } from '@/lib/utils';
import { useEventLogs } from '../hooks/useEventLogs';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PanelErrorState } from '../components/PanelErrorState';

interface EventLogFeedProps {
  className?: string;
  module?: string;
  refreshToken?: number;
}

const pagerButtonClass = cn(
  'inline-flex items-center gap-1 rounded-md border border-border-default px-2.5 py-1.5 text-xs font-medium',
  'text-foreground-secondary bg-surface-1/60',
  'transition-all duration-200 hover:bg-surface-2 hover:border-border-strong hover:text-foreground',
  'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50',
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100'
);

export function EventLogFeed({ className, module, refreshToken = 0 }: EventLogFeedProps) {
  const { data: events, loading, error, pagination, page, setPage } = useEventLogs(
    module,
    8,
    refreshToken
  );

  if (loading && events.length === 0) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Event Log"
          subtitle="Loading..."
          icon={<ScrollText className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Event Log"
          subtitle="Error loading events"
          icon={<ScrollText className="w-5 h-5" />}
        />
        <PanelErrorState message={error} />
      </Card>
    );
  }

  const canPrev = page > 1;
  const canNext = page < pagination.totalPages;

  return (
    <Card className={className}>
      <SectionHeader
        title="Event Log"
        subtitle={`Trang ${pagination.page}/${pagination.totalPages} · ${pagination.total} sự kiện`}
        icon={<ScrollText className="w-5 h-5" />}
      />

      <div className="flex items-center justify-end gap-2 px-4 pb-2 -mt-1">
        <button
          type="button"
          disabled={!canPrev || loading}
          onClick={() => setPage(page - 1)}
          className={pagerButtonClass}
          aria-label="Trang trước"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Trước
        </button>
        <span className="text-xs text-foreground-tertiary tabular-nums px-1">
          {pagination.page} / {pagination.totalPages}
        </span>
        <button
          type="button"
          disabled={!canNext || loading}
          onClick={() => setPage(page + 1)}
          className={pagerButtonClass}
          aria-label="Trang sau"
        >
          Sau
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2.5 max-h-[400px] overflow-y-auto overflow-x-hidden px-4 pb-4">
        {events.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No events yet"
            description="Pipeline events will appear here as the worker runs."
            size="sm"
          />
        ) : (
          events.map((event) => (
            <EventLogItem
              key={event.id}
              timestamp={formatVietnamTime(event.timestamp)}
              module={event.module}
              message={event.message}
              severity={event.severity as 'info' | 'warning' | 'error'}
              details={event.details}
            />
          ))
        )}
      </div>
    </Card>
  );
}
