'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Clock, PlayCircle, PauseCircle } from 'lucide-react';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PanelErrorState } from '../components/PanelErrorState';

interface SchedulerStatusPanelProps {
  className?: string;
}

export function SchedulerStatusPanel({ className }: SchedulerStatusPanelProps) {
  const { data, loading, error } = useDashboardSummary();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Scheduler Status"
          subtitle="Loading..."
          icon={<Clock className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Scheduler Status"
          subtitle="Error loading data"
          icon={<Clock className="w-5 h-5" />}
        />
        <PanelErrorState message={error || 'Failed to load scheduler data'} />
      </Card>
    );
  }

  const schedulers = data.schedulers;

  return (
    <Card className={className}>
      <SectionHeader
        title="Scheduler Status"
        subtitle="Background task status"
        icon={<Clock className="w-5 h-5" />}
      />

      <div className="space-y-3">
        {schedulers.map((scheduler) => (
          <div
            key={scheduler.name}
            className="panel-stat space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{scheduler.name}</span>
              <div className="flex items-center gap-2">
                {scheduler.status === 'running' ? (
                  <PlayCircle className="w-4 h-4 text-success" />
                ) : (
                  <PauseCircle className="w-4 h-4 text-warning" />
                )}
                <StatusBadge
                  status={scheduler.status === 'running' ? 'trading_enabled' : 'trading_paused'}
                  label={scheduler.status === 'running' ? 'Running' : 'Paused'}
                  size="sm"
                />
              </div>
            </div>
            <div className="text-xs text-foreground-tertiary">
              <span className="text-foreground-tertiary">Cron: </span>
              <span className="font-mono break-all">{scheduler.cron}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-foreground-tertiary">
              <span className="truncate">Last: {scheduler.lastRun}</span>
              <span className="truncate sm:text-right">Next: {scheduler.nextRun}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
