'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { ReasonChip } from '../components/ReasonChip';
import { Ban } from 'lucide-react';
import { useIntelligenceData } from '../hooks/useIntelligenceData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface NoTradeReasonsPanelProps {
  className?: string;
}

export function NoTradeReasonsPanel({ className }: NoTradeReasonsPanelProps) {
  const { data, loading, error } = useIntelligenceData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="No-Trade Reasons"
          subtitle="Loading..."
          icon={<Ban className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="No-Trade Reasons"
          subtitle="Error loading data"
          icon={<Ban className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-red-500">{error}</div>
      </Card>
    );
  }

  const noTradeReasons = data?.noTradeReasons || [];
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
            className="flex items-center justify-between gap-3 p-3 bg-surface-1/50 rounded-lg"
          >
            <span className="text-sm text-foreground-secondary min-w-0 truncate">{item.reason}</span>
            <ReasonChip 
              label={item.count > 0 ? `${item.count} blocks` : 'No blocks'} 
              count={item.count}
              variant={item.variant as 'default' | 'warning' | 'danger' | 'info'}
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
