'use client';

import { History, TrendingUp, TrendingDown, XCircle, CheckCircle2, Target } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { cn, formatPrice } from '@/lib/utils';
import type { Trade } from '../types';

interface HistorySectionProps {
  trades: Trade[];
}

export function HistorySection({ trades }: HistorySectionProps) {
  if (trades.length === 0) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Trade History" 
          subtitle="No completed trades yet"
          icon={<History className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <p className="text-foreground-tertiary text-sm text-center py-8">
            No trade history available. Positions will appear here when closed.
          </p>
        </Card>
      </section>
    );
  }

  // Show only last 10 trades
  const recentTrades = trades.slice(0, 10);

  return (
    <section className="mb-8">
      <CardHeader 
        title={`Trade History (${trades.length})`}
        subtitle="Last 10 closed positions"
        icon={<History className="w-5 h-5" />}
      />
      
      <Card className="mt-4 overflow-hidden" padding="none">
        {/* Mobile View */}
        <div className="sm:hidden">
          {recentTrades.map(trade => (
            <TradeCardMobile key={trade.id} trade={trade} />
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-1 border-b border-border-default">
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-secondary">Symbol</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-secondary">Side</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Entry</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Exit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">PnL</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">R-Multiple</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-secondary">Exit Reason</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Closed</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((trade, index) => (
                <tr 
                  key={trade.id} 
                  className={cn(
                    'border-b border-border-subtle last:border-0',
                    'hover:bg-surface-1/50 transition-colors'
                  )}
                >
                  <td className="px-4 py-3">
                    <span className="font-bold text-foreground">{trade.symbol}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={trade.side === 'long' ? 'success' : 'danger'} size="sm">
                      {trade.side.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    ${formatPrice(trade.entry_price)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    ${formatPrice(trade.exit_price)}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-mono font-medium',
                    trade.realized_pnl >= 0 ? 'text-success' : 'text-danger'
                  )}>
                    {trade.realized_pnl >= 0 ? '+' : ''}${formatPrice(trade.realized_pnl)}
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-mono',
                    (trade.r_multiple || 0) >= 0 ? 'text-success' : 'text-danger'
                  )}>
                    {(trade.r_multiple || 0) >= 0 ? '+' : ''}{trade.r_multiple?.toFixed(2) || '0.00'}R
                  </td>
                  <td className="px-4 py-3">
                    <ExitReasonBadge reason={trade.exit_reason} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-foreground-tertiary">
                    {new Date(trade.closed_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function TradeCardMobile({ trade }: { trade: Trade }) {
  return (
    <div className="p-4 border-b border-border-subtle last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground">{trade.symbol}</span>
          <Badge variant={trade.side === 'long' ? 'success' : 'danger'} size="sm">
            {trade.side.toUpperCase()}
          </Badge>
        </div>
        <span className={cn(
          'font-mono font-medium',
          trade.realized_pnl >= 0 ? 'text-success' : 'text-danger'
        )}>
          {trade.realized_pnl >= 0 ? '+' : ''}${formatPrice(trade.realized_pnl)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-foreground-secondary mb-2">
        <div>Entry: <span className="font-mono text-foreground">${formatPrice(trade.entry_price)}</span></div>
        <div>Exit: <span className="font-mono text-foreground">${formatPrice(trade.exit_price)}</span></div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <ExitReasonBadge reason={trade.exit_reason} />
        <span className="text-foreground-tertiary">
          {new Date(trade.closed_at).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

function ExitReasonBadge({ reason }: { reason: string }) {
  const configs: Record<string, { variant: 'success' | 'danger' | 'warning' | 'info'; icon: React.ReactNode }> = {
    'take_profit': { variant: 'success', icon: <CheckCircle2 size={12} /> },
    'stop_loss': { variant: 'danger', icon: <XCircle size={12} /> },
    'manual': { variant: 'info', icon: <Target size={12} /> },
  };

  const config = configs[reason] || { variant: 'neutral', icon: null };
  const label = reason.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <Badge variant={config.variant} size="sm">
      {config.icon}
      {label}
    </Badge>
  );
}
