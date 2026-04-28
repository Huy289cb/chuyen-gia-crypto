'use client';

import { XCircle, Target, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { cn, formatPrice, formatVietnamTime } from '@/lib/utils';
import type { Position } from '../types';

interface PositionsSectionProps {
  positions: Position[];
  onClosePosition: (positionId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
}

export function PositionsSection({ positions, onClosePosition }: PositionsSectionProps) {
  // Filter out ETH positions - only show BTC positions
  const btcPositions = positions.filter(position => position.symbol === 'BTC');
  
  if (btcPositions.length === 0) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Open Positions" 
          subtitle="No active positions"
          icon={<Target className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <p className="text-foreground-tertiary text-sm text-center py-8">
            No open positions. Waiting for high-confidence signals...
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <CardHeader 
        title={`Open Positions (${btcPositions.length})`}
        icon={<Target className="w-5 h-5" />}
      />
      
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {btcPositions.map(position => (
          <PositionCard 
            key={position.id} 
            position={position} 
            onClose={onClosePosition}
          />
        ))}
      </div>
    </section>
  );
}

function PositionCard({ position, onClose }: { position: Position; onClose: (id: string) => Promise<{ success: boolean }> }) {
  const isLong = position.side === 'long';
  const pnlPercent = position.size_usd > 0 ? ((position.unrealized_pnl || 0) / position.size_usd) * 100 : 0;
  const isProfitable = pnlPercent >= 0;

  // SL/TP progress
  const slDistance = Math.abs(position.entry_price - position.stop_loss);
  const tpDistance = Math.abs(position.take_profit - position.entry_price);
  const totalDistance = slDistance + tpDistance;
  const currentDistance = isLong 
    ? position.current_price - position.stop_loss
    : position.stop_loss - position.current_price;
  const progressPercent = totalDistance > 0 ? (currentDistance / totalDistance) * 100 : 0;

  return (
    <Card className="relative">
      {/* Close Button */}
      <button
        onClick={() => onClose(position.id)}
        className="absolute top-3 right-3 p-1.5 rounded-lg text-foreground-tertiary hover:text-danger hover:bg-danger-dim transition-colors"
        title="Close position"
      >
        <XCircle className="w-5 h-5" />
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 pr-10">
        <div className="flex items-center gap-3">
          <Badge variant={isLong ? 'success' : 'danger'}>
            {isLong ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {position.side.toUpperCase()}
          </Badge>
          <span className="font-bold text-foreground text-lg">{position.symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-foreground-tertiary text-xs">Opened</span>
          <Badge variant="neutral" className="text-xs">
            {formatVietnamTime(position.entry_time)}
          </Badge>
        </div>
      </div>

      {/* PnL */}
      <div className="mb-4">
        <div className={cn('text-2xl font-bold font-mono', isProfitable ? 'text-success' : 'text-danger')}>
          {isProfitable ? '+' : ''}${formatPrice(position.unrealized_pnl || 0)}
        </div>
        <div className={cn('text-sm', isProfitable ? 'text-success/70' : 'text-danger/70')}>
          {isProfitable ? '+' : ''}{pnlPercent.toFixed(1)}%
        </div>
      </div>

      {/* Price Grid */}
      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div className="bg-surface-1 rounded-lg p-2">
          <span className="text-foreground-tertiary text-xs block">Entry</span>
          <span className="font-mono text-foreground">${formatPrice(position.entry_price)}</span>
        </div>
        <div className="bg-surface-1 rounded-lg p-2">
          <span className="text-foreground-tertiary text-xs block">Current</span>
          <span className="font-mono text-foreground">${formatPrice(position.current_price)}</span>
        </div>
        <div className="bg-danger-dim rounded-lg p-2">
          <span className="text-danger text-xs block">Stop Loss</span>
          <span className="font-mono text-danger">${formatPrice(position.stop_loss)}</span>
        </div>
        <div className="bg-success-dim rounded-lg p-2">
          <span className="text-success text-xs block">Take Profit</span>
          <span className="font-mono text-success">${formatPrice(position.take_profit)}</span>
        </div>
      </div>

      {/* SL/TP Progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-foreground-tertiary mb-1">
          <span>SL</span>
          <span>Progress</span>
          <span>TP</span>
        </div>
        <div className="relative h-2 bg-surface-2 rounded-full overflow-hidden">
          <div
            className={cn(
              'absolute h-full transition-all rounded-full',
              isProfitable ? 'bg-success' : 'bg-danger'
            )}
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          />
          {/* Entry marker */}
          <div 
            className="absolute top-0 w-0.5 h-full bg-foreground"
            style={{ left: `${(slDistance / totalDistance) * 100}%` }}
          />
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-foreground-tertiary pt-3 border-t border-border-default">
        <span>Size: ${formatPrice(position.size_usd)}</span>
        <span>Risk: {position.risk_percent}%</span>
        <span>R:R {position.expected_rr?.toFixed(1)}</span>
      </div>
    </Card>
  );
}
