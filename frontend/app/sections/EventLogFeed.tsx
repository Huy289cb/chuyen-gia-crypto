'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EventLogItem } from '../components/EventLogItem';
import { ScrollText } from 'lucide-react';
import { formatVietnamTime } from '@/lib/utils';

interface EventLogFeedProps {
  className?: string;
}

export function EventLogFeed({ className }: EventLogFeedProps) {
  // TODO: Replace with actual data from API
  const events = [
    {
      id: 1,
      timestamp: new Date(Date.now() - 60000).toISOString(),
      module: 'Signal Gate',
      message: 'Signal passed validation',
      severity: 'success' as const,
      details: 'Grade A, confidence 85%',
    },
    {
      id: 2,
      timestamp: new Date(Date.now() - 120000).toISOString(),
      module: 'Risk Engine',
      message: 'Risk check passed',
      severity: 'success' as const,
      details: 'Daily loss limit not reached',
    },
    {
      id: 3,
      timestamp: new Date(Date.now() - 180000).toISOString(),
      module: 'LLM Dispatch',
      message: 'Groq call successful',
      severity: 'info' as const,
      details: 'Model: llama-3.3-70b-versatile',
    },
    {
      id: 4,
      timestamp: new Date(Date.now() - 240000).toISOString(),
      module: 'Position Monitor',
      message: 'Position updated',
      severity: 'info' as const,
      details: 'BTC position PnL: +50 USDT',
    },
    {
      id: 5,
      timestamp: new Date(Date.now() - 300000).toISOString(),
      module: 'Market Scan',
      message: 'Candle data saved',
      severity: 'success' as const,
      details: '15m timeframe, 100 candles',
    },
  ];

  return (
    <Card className={className}>
      <SectionHeader
        title="Event Log"
        subtitle={`Recent: ${events.length}`}
        icon={<ScrollText className="w-5 h-5" />}
      />
      
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {events.map((event) => (
          <EventLogItem
            key={event.id}
            timestamp={formatVietnamTime(event.timestamp)}
            module={event.module}
            message={event.message}
            severity={event.severity}
            details={event.details}
          />
        ))}
      </div>
    </Card>
  );
}
