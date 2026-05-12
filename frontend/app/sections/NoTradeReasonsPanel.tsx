'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { ReasonChip } from '../components/ReasonChip';
import { Ban } from 'lucide-react';

interface NoTradeReasonsPanelProps {
  className?: string;
}

export function NoTradeReasonsPanel({ className }: NoTradeReasonsPanelProps) {
  // TODO: Replace with actual data from API
  const noTradeReasons = [
    { reason: 'Insufficient candles', count: 5, variant: 'warning' as const },
    { reason: 'Grade below A', count: 3, variant: 'default' as const },
    { reason: 'Spread too high', count: 2, variant: 'warning' as const },
    { reason: 'Daily loss limit hit', count: 0, variant: 'danger' as const },
    { reason: 'Consecutive losses limit', count: 0, variant: 'danger' as const },
  ];

  const totalBlocks = noTradeReasons.reduce((sum, r) => sum + r.count, 0);

  return (
    <Card className={className}>
      <SectionHeader
        title="No-Trade Reasons"
        subtitle={`Total blocks: ${totalBlocks}`}
        icon={<Ban className="w-5 h-5" />}
      />
      
      <div className="space-y-3">
        {noTradeReasons.map((item) => (
          <div 
            key={item.reason}
            className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg"
          >
            <span className="text-sm text-foreground-secondary">{item.reason}</span>
            <ReasonChip 
              label={item.count > 0 ? `${item.count} blocks` : 'No blocks'} 
              count={item.count}
              variant={item.variant}
            />
          </div>
        ))}
      </div>

      {totalBlocks === 0 && (
        <div className="mt-4 pt-4 border-t border-border-default text-center">
          <p className="text-sm text-success font-medium">No active blocks</p>
          <p className="text-xs text-foreground-tertiary mt-1">System is ready to trade</p>
        </div>
      )}
    </Card>
  );
}
