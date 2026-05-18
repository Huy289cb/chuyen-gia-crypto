'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EventLogItem } from '../components/EventLogItem';
import { ScrollText } from 'lucide-react';
import { formatVietnamTime } from '@/lib/utils';
import { useEventLogs } from '../hooks/useEventLogs';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface EventLogFeedProps {
  className?: string;
  module?: string;
}

export function EventLogFeed({ className, module }: EventLogFeedProps) {
  const { data: events, loading, error, refresh } = useEventLogs(module, 20);

  if (loading) {
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

  return (
    <Card className={className}>
      <SectionHeader
        title="Event Log"
        subtitle={`Recent: ${events.length}`}
        icon={<ScrollText className="w-5 h-5" />}
      />

      <div className="space-y-2.5 max-h-[400px] overflow-y-auto overflow-x-hidden">
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
              severity={event.severity as any}
              details={event.details}
            />
          ))
        )}
      </div>
    </Card>
  );
}
