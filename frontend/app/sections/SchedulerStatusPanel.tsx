'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Clock, PlayCircle, PauseCircle } from 'lucide-react';

interface SchedulerStatusPanelProps {
  className?: string;
}

export function SchedulerStatusPanel({ className }: SchedulerStatusPanelProps) {
  // TODO: Replace with actual data from API
  const schedulers = [
    {
      name: 'MarketScan',
      status: 'running' as const,
      lastRun: '2 min ago',
      nextRun: 'in 3 min',
    },
    {
      name: 'LLMDispatch',
      status: 'running' as const,
      lastRun: '5 min ago',
      nextRun: 'in 8 min',
    },
    {
      name: 'PositionMonitor',
      status: 'running' as const,
      lastRun: '1 min ago',
      nextRun: 'in 1 min',
    },
  ];

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
            className="p-3 bg-surface-1/50 rounded-lg space-y-2"
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
            <div className="flex items-center justify-between text-xs text-foreground-tertiary">
              <span>Last: {scheduler.lastRun}</span>
              <span>Next: {scheduler.nextRun}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
