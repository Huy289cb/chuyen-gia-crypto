'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { History } from 'lucide-react';
import { cn, formatPrice, formatVietnamTime } from '@/lib/utils';
import { useAccountData } from '../hooks/useAccountData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface TradeHistoryPanelProps {
  className?: string;
}

export function TradeHistoryPanel({ className }: TradeHistoryPanelProps) {
  const { data, loading, error } = useAccountData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Trade History"
          subtitle="Loading..."
          icon={<History className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Trade History"
          subtitle="Error loading data"
          icon={<History className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-red-500">{error}</div>
      </Card>
    );
  }

  const trades = data?.trades || [];

  if (trades.length === 0) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Trade History"
          subtitle="Recent trades"
          icon={<History className="w-5 h-5" />}
        />
        <EmptyState
          title="No Trade History"
          description="No trades have been executed yet."
          size="sm"
        />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <SectionHeader
        title="Trade History"
        subtitle={`Recent: ${trades.length}`}
        icon={<History className="w-5 h-5" />}
      />

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="p-3 bg-surface-1/50 rounded-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{trade.symbol}</span>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded',
                  trade.side.toLowerCase() === 'long' || trade.side.toLowerCase() === 'buy'
                    ? 'bg-success/15 text-success'
                    : 'bg-danger/15 text-danger'
                )}>
                  {trade.side.toUpperCase()}
                </span>
              </div>
              <span className="text-xs text-foreground-tertiary">{formatVietnamTime(trade.closedAt)}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-foreground-tertiary">Price:</span>
                <span className="ml-1 font-mono text-foreground">{formatPrice(trade.price)}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">Qty:</span>
                <span className="ml-1 font-mono text-foreground">{trade.quantity}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">Fee:</span>
                <span className="ml-1 font-mono text-foreground-tertiary">{formatPrice(trade.fee)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border-default">
              <span className="text-xs text-foreground-tertiary">Realized PnL</span>
              <span className={cn(
                'text-sm font-mono font-semibold',
                trade.realizedPnL >= 0 ? 'text-success' : 'text-danger'
              )}>
                {trade.realizedPnL >= 0 ? '+' : ''}{formatPrice(trade.realizedPnL)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
