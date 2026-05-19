'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EventLogItem } from '../components/EventLogItem';
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatVietnamTime } from '@/lib/utils';
import { useEventLogs } from '../hooks/useEventLogs';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface EventLogFeedProps {
  className?: string;
  module?: string;
}

export function EventLogFeed({ className, module }: EventLogFeedProps) {
  const { data: events, loading, error, pagination, page, setPage } = useEventLogs(module, 8);

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
        <div className="p-4 text-sm text-red-500">{error}</div>
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
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground-secondary hover:bg-muted disabled:opacity-40"
          aria-label="Trang trước"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Trước
        </button>
        <span className="text-xs text-foreground-tertiary tabular-nums">
          {pagination.page} / {pagination.totalPages}
        </span>
        <button
          type="button"
          disabled={!canNext || loading}
          onClick={() => setPage(page + 1)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground-secondary hover:bg-muted disabled:opacity-40"
          aria-label="Trang sau"
        >
          Sau
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2.5 max-h-[400px] overflow-y-auto overflow-x-hidden px-4 pb-4">
        {events.length === 0 ? (
          <div className="p-4 text-sm text-foreground-tertiary text-center">
            No events available
          </div>
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
