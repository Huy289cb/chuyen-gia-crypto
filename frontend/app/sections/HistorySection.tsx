'use client';

import { useState, useEffect } from 'react';
import { History, TrendingUp, TrendingDown, XCircle, CheckCircle2, Target, ChevronLeft, ChevronRight, Activity } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { cn, formatPrice } from '@/lib/utils';
import type { Trade } from '../types';

// Helper function to format timestamp to GMT+7
const formatToGMT7 = (timestamp: string) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  // Add 7 hours offset to convert UTC to GMT+7
  const gmt7Date = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return gmt7Date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

interface HistorySectionProps {
  symbol?: string;
  method?: string;
  refreshKey?: number;
}

export function HistorySection({ symbol = 'BTC', method = 'kim_nghia', refreshKey = 0 }: HistorySectionProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 0, page: 1, limit: 10 });

  useEffect(() => {
    const fetchTrades = async () => {
      setLoading(true);
      try {
        const API_BASE = process.env.NODE_ENV === 'development'
          ? 'http://localhost:3000/api'
          : '/api';
        const response = await fetch(`${API_BASE}/performance/trades?symbol=${symbol}&limit=${itemsPerPage}&page=${currentPage}&method=${method}`);
        const data = await response.json();
        if (data.success && data.data) {
          setTrades(data.data);
          setPagination(data.meta);
        }
      } catch (err) {
        console.error('Error fetching trades:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTrades();
  }, [symbol, method, currentPage, itemsPerPage, refreshKey]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setCurrentPage(newPage);
    }
  };

  if (loading) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Trade History" 
          subtitle="Loading..."
          icon={<History className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <div className="animate-pulse space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-surface-1 rounded-lg" />
            ))}
          </div>
        </Card>
      </section>
    );
  }

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

  return (
    <section className="mb-8">
      <CardHeader 
        title={`Trade History (${pagination.total})`}
        subtitle={`Page ${pagination.page} of ${pagination.totalPages} (${symbol} trades)`}
        icon={<History className="w-5 h-5" />}
      />
      
      <Card className="mt-4 overflow-hidden" padding="none">
        {/* Mobile View */}
        <div className="sm:hidden">
          {trades.map((trade: Trade) => (
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
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Size</th>
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
              {trades.map((trade: Trade, index: number) => (
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
                    ${formatPrice(trade.size_usd)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-foreground-tertiary">
                    {formatToGMT7(trade.entry_time || trade.opened_at || '')}
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
                    {formatToGMT7(trade.close_time || trade.closed_at || '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            leftIcon={<ChevronLeft size={16} />}
          >
            Previous
          </Button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(page => (
              <Button
                key={page}
                variant={currentPage === page ? "primary" : "ghost"}
                size="sm"
                onClick={() => handlePageChange(page)}
                className="min-w-[2.5rem]"
              >
                {page}
              </Button>
            ))}
          </div>
          
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === pagination.totalPages}
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
        <div>Size: <span className="font-mono text-foreground">${formatPrice(trade.size_usd)}</span></div>
        <div>R: <span className="font-mono text-foreground">{trade.r_multiple?.toFixed(2) || '0.00'}R</span></div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <ExitReasonBadge reason={trade.close_reason || trade.exit_reason} />
        <span className="text-foreground-tertiary">
          {formatToGMT7(trade.close_time || trade.closed_at || '')}
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
