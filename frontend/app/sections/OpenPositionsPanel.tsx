'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { Target, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { cn, formatPrice, formatVietnamTime } from '@/lib/utils';

interface OpenPositionsPanelProps {
  className?: string;
}

export function OpenPositionsPanel({ className }: OpenPositionsPanelProps) {
  // TODO: Replace with actual data from API
  const positions = [
    {
      id: '1',
      symbol: 'BTC',
      side: 'LONG' as const,
      size: 0.1,
      entryPrice: 95000,
      markPrice: 95500,
      unrealizedPnL: 50,
      pnlPercentage: 0.53,
      stopLoss: 94000,
      takeProfit: 97000,
      timeInPosition: '2h 15m',
    },
  ];

  if (positions.length === 0) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Open Positions"
          subtitle="Active trades"
          icon={<Target className="w-5 h-5" />}
        />
        <EmptyState
          title="No Open Positions"
          description="You have no active positions at the moment."
          size="sm"
        />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <SectionHeader
        title="Open Positions"
        subtitle={`Active: ${positions.length}`}
        icon={<Target className="w-5 h-5" />}
      />
      
      <div className="space-y-3">
        {positions.map((position) => (
          <div 
            key={position.id}
            className="p-3 bg-surface-1/50 rounded-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{position.symbol}</span>
                <StatusBadge 
                  status={position.side === 'LONG' ? 'trading_enabled' : 'blocked'}
                  label={position.side}
                  size="sm"
                />
              </div>
              <div className="flex items-center gap-1 text-xs text-foreground-tertiary">
                <Clock className="w-3 h-3" />
                {position.timeInPosition}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-foreground-tertiary">Size:</span>
                <span className="ml-1 font-mono text-foreground">{position.size}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">Entry:</span>
                <span className="ml-1 font-mono text-foreground">{formatPrice(position.entryPrice)}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">Mark:</span>
                <span className="ml-1 font-mono text-foreground">{formatPrice(position.markPrice)}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">PnL:</span>
                <span className={cn(
                  'ml-1 font-mono font-semibold',
                  position.unrealizedPnL >= 0 ? 'text-success' : 'text-danger'
                )}>
                  {position.unrealizedPnL >= 0 ? '+' : ''}{formatPrice(position.unrealizedPnL)}
                  <span className="text-foreground-tertiary"> ({position.pnlPercentage}%)</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border-default">
              <div>
                <span className="text-foreground-tertiary">SL:</span>
                <span className="ml-1 font-mono text-danger">{formatPrice(position.stopLoss)}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">TP:</span>
                <span className="ml-1 font-mono text-success">{formatPrice(position.takeProfit)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
