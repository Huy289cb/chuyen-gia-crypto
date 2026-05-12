'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface IndicatorPanelProps {
  className?: string;
}

export function IndicatorPanel({ className }: IndicatorPanelProps) {
  // TODO: Replace with actual indicator data from API
  const indicators = [
    { name: 'Moving Average (50)', value: '94,250.50', trend: 'up' },
    { name: 'Moving Average (200)', value: '92,100.00', trend: 'up' },
    { name: 'RSI (14)', value: '58.5', trend: 'neutral' },
    { name: 'MACD', value: '125.50', trend: 'up' },
  ];

  return (
    <Card className={className}>
      <SectionHeader
        title="Indicators"
        subtitle="Technical analysis overlays"
        icon={<Activity className="w-5 h-5" />}
      />
      
      <div className="space-y-3">
        {indicators.map((indicator) => (
          <div 
            key={indicator.name}
            className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg"
          >
            <span className="text-sm text-foreground-secondary">{indicator.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-foreground">{indicator.value}</span>
              <span className={cn(
                'text-xs',
                indicator.trend === 'up' ? 'text-success' : 
                indicator.trend === 'down' ? 'text-danger' : 'text-foreground-tertiary'
              )}>
                {indicator.trend === 'up' ? '↑' : indicator.trend === 'down' ? '↓' : '•'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border-default">
        <EmptyState
          title="More Indicators"
          description="Additional indicators (ATR, VWAP, Volume) will be available after backend integration."
          size="sm"
        />
      </div>
    </Card>
  );
}
