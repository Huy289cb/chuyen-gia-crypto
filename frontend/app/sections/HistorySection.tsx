'use client';

import { useState } from 'react';
import { History, TrendingUp, TrendingDown, XCircle, CheckCircle2, Target, ChevronLeft, ChevronRight, Activity } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { cn, formatPrice } from '@/lib/utils';
import type { Trade } from '../types';

interface HistorySectionProps {
  trades: Trade[];
}

export function HistorySection({ trades }: HistorySectionProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const tradesPerPage = 10;
  
  // Filter BTC trades only
  const btcTrades = trades.filter(trade => trade.symbol === 'BTC');
  
  if (btcTrades.length === 0) {
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

  // Pagination logic
  const totalPages = Math.ceil(btcTrades.length / tradesPerPage);
  const startIndex = (currentPage - 1) * tradesPerPage;
  const endIndex = startIndex + tradesPerPage;
  const currentTrades = btcTrades.slice(startIndex, endIndex);

  return (
    <section className="mb-8">
      <CardHeader 
        title={`Trade History (${btcTrades.length})`}
        subtitle={`Page ${currentPage} of ${totalPages} (BTC trades only)`}
        icon={<History className="w-5 h-5" />}
      />
      
      <Card className="mt-4 overflow-hidden" padding="none">
        {/* Mobile View */}
        <div className="sm:hidden">
          {currentTrades.map((trade: Trade) => (
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
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Opened</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Entry</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Exit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">PnL</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">R-Multiple</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-secondary">Exit Reason</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Closed</th>
              </tr>
            </thead>
            <tbody>
              {currentTrades.map((trade: Trade, index: number) => (
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
                  <td className="px-4 py-3 text-right text-xs text-foreground-tertiary">
                    {trade.entry_time || trade.opened_at ? new Date(trade.entry_time || trade.opened_at!).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    ${formatPrice(trade.entry_price)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    ${formatPrice(trade.close_price || trade.exit_price || 0)}
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
                    <ExitReasonBadge reason={trade.close_reason || trade.exit_reason} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-foreground-tertiary">
                    {trade.close_time || trade.closed_at ? new Date(trade.close_time || trade.closed_at!).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            leftIcon={<ChevronLeft size={16} />}
          >
            Previous
          </Button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <Button
                key={page}
                variant={currentPage === page ? "primary" : "ghost"}
                size="sm"
                onClick={() => setCurrentPage(page)}
                className="min-w-[2.5rem]"
              >
                {page}
              </Button>
            ))}
          </div>
          
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            rightIcon={<ChevronRight size={16} />}
          >
            Next
          </Button>
        </div>
      )}
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
        <div>Exit: <span className="font-mono text-foreground">${formatPrice(trade.close_price || trade.exit_price || 0)}</span></div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <ExitReasonBadge reason={trade.close_reason || trade.exit_reason} />
        <span className="text-foreground-tertiary">
          {trade.close_time || trade.closed_at ? new Date(trade.close_time || trade.closed_at!).toLocaleDateString() : '-'}
        </span>
      </div>
    </div>
  );
}

function ExitReasonBadge({ reason }: { reason: string | undefined }) {
  const configs: Record<string, { variant: 'success' | 'danger' | 'warning' | 'info'; icon: React.ReactNode }> = {
    'take_profit': { variant: 'success', icon: <CheckCircle2 size={12} /> },
    'stop_loss': { variant: 'danger', icon: <XCircle size={12} /> },
    'manual': { variant: 'info', icon: <Target size={12} /> },
    'prediction_reversal': { variant: 'warning', icon: <Activity size={12} /> },
  };

  const safeReason = reason || 'unknown';
  const config = configs[safeReason] || { variant: 'neutral', icon: null };
  const label = safeReason.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <Badge variant={config.variant} size="sm">
      {config.icon}
      {label}
    </Badge>
  );
}
