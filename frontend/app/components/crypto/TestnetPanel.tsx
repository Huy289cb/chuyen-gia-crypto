'use client';

import { useState } from 'react';
import { RefreshCw, DollarSign, TrendingUp, TrendingDown, PlayCircle, XCircle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useTestnet, type TestnetAccount, type TestnetPosition, type TestnetPendingOrder } from '@/app/hooks/useTestnet';
import { cn, formatPrice, formatVietnamTime } from '@/lib/utils';

export function TestnetPanel() {
  const {
    account,
    positions,
    pendingOrders,
    performance,
    tradeHistory,
    loading,
    error,
    syncing,
    lastSyncTime,
    refresh,
    syncAccount,
    resetAccount,
    closePosition,
    cancelPendingOrder,
  } = useTestnet();

  if (loading && !account) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="w-6 h-6 animate-spin text-foreground-tertiary" />
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-center text-danger">
          <p className="font-medium">Error loading testnet data</p>
          <p className="text-sm text-foreground-tertiary mt-1">{error}</p>
          <Button onClick={refresh} variant="secondary" size="sm" className="mt-4">
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!account) {
    return (
      <Card className="p-6">
        <div className="text-center text-foreground-tertiary">
          <p className="font-medium">No testnet account found</p>
          <p className="text-sm mt-1">Please enable testnet integration in backend</p>
        </div>
      </Card>
    );
  }

  const winRate = performance?.win_rate || 0;
  const profitFactor = performance?.profit_factor || 0;
  const totalReturn = performance?.total_return || 0;

  return (
    <div className="space-y-4">
      {/* Account Info */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Binance Testnet</h3>
            <p className="text-sm text-foreground-tertiary">{account.symbol} - {account.method_id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral" className="text-xs">
              {lastSyncTime ? `Synced: ${formatVietnamTime(lastSyncTime)}` : 'Not synced'}
            </Badge>
            <Button
              onClick={syncAccount}
              disabled={syncing}
              variant="secondary"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className={cn('w-4 h-4', syncing && 'animate-spin')} />
              Sync
            </Button>
            <Button
              onClick={resetAccount}
              variant="danger"
              size="sm"
              className="gap-2"
            >
              <PlayCircle className="w-4 h-4" />
              Reset
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Balance</p>
            <p className="text-lg font-semibold">${formatPrice(account.current_balance)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Equity</p>
            <p className="text-lg font-semibold">${formatPrice(account.equity)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Unrealized PnL</p>
            <p className={cn('text-lg font-semibold', account.unrealized_pnl >= 0 ? 'text-success' : 'text-danger')}>
              {account.unrealized_pnl >= 0 ? '+' : ''}{formatPrice(account.unrealized_pnl)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Realized PnL</p>
            <p className={cn('text-lg font-semibold', account.realized_pnl >= 0 ? 'text-success' : 'text-danger')}>
              {account.realized_pnl >= 0 ? '+' : ''}{formatPrice(account.realized_pnl)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-surface-2">
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Win Rate</p>
            <p className="text-lg font-semibold">{winRate.toFixed(1)}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Profit Factor</p>
            <p className="text-lg font-semibold">{profitFactor.toFixed(2)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Total Return</p>
            <p className={cn('text-lg font-semibold', totalReturn >= 0 ? 'text-success' : 'text-danger')}>
              {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(1)}%
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Max Drawdown</p>
            <p className="text-lg font-semibold text-danger">-{account.max_drawdown.toFixed(1)}%</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-surface-2">
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Total Trades</p>
            <p className="text-lg font-semibold">{account.total_trades}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Winning</p>
            <p className="text-lg font-semibold text-success">{account.winning_trades}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground-tertiary">Losing</p>
            <p className="text-lg font-semibold text-danger">{account.losing_trades}</p>
          </div>
        </div>
      </Card>

      {/* Pending Orders */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Pending Orders</h3>
          <Badge variant="neutral">{pendingOrders.length}</Badge>
        </div>

        {pendingOrders.length === 0 ? (
          <div className="text-center py-8 text-foreground-tertiary">
            <p>No pending orders</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingOrders.map((order) => (
              <PendingOrderCard key={order.order_id} order={order} onCancel={cancelPendingOrder} />
            ))}
          </div>
        )}
      </Card>

      {/* Open Positions */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Open Positions</h3>
          <Badge variant="neutral">{positions.length}</Badge>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-8 text-foreground-tertiary">
            <p>No open positions</p>
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map((position) => (
              <PositionCard key={position.position_id} position={position} onClose={closePosition} />
            ))}
          </div>
        )}
      </Card>

      {/* Trade History */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Trade History</h3>
          <Badge variant="neutral">{tradeHistory.length}</Badge>
        </div>

        {tradeHistory.length === 0 ? (
          <div className="text-center py-8 text-foreground-tertiary">
            <p>No trade history</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tradeHistory.map((trade) => (
              <TradeHistoryCard key={trade.position_id} trade={trade} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function PositionCard({ position, onClose }: { position: TestnetPosition; onClose: (id: string) => Promise<any> }) {
  const [closing, setClosing] = useState(false);

  const handleClose = async () => {
    setClosing(true);
    await onClose(position.position_id);
    setClosing(false);
  };

  const isLong = position.side === 'BUY';
  const pnlPercent = position.entry_price > 0 
    ? ((position.current_price - position.entry_price) / position.entry_price) * 100 * (isLong ? 1 : -1)
    : 0;

  return (
    <div className="p-4 bg-surface-1 rounded-lg border border-surface-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant={isLong ? 'success' : 'danger'} className="text-xs">
            {position.side}
          </Badge>
          <span className="font-medium">{position.symbol}</span>
        </div>
        <Badge variant="neutral" className="text-xs">
            {formatVietnamTime(position.entry_time)}
          </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-foreground-tertiary text-xs">Entry</p>
          <p className="font-medium">${formatPrice(position.entry_price)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Current</p>
          <p className="font-medium">${formatPrice(position.current_price)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Volume</p>
          <p className="font-medium">${formatPrice(position.size_usd)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Leverage</p>
          <p className="font-medium">20x</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-2">
        <div>
          <p className="text-foreground-tertiary text-xs">Unrealized PnL</p>
          <p className={cn('font-medium', position.unrealized_pnl >= 0 ? 'text-success' : 'text-danger')}>
            {position.unrealized_pnl >= 0 ? '+' : ''}{formatPrice(position.unrealized_pnl)}
          </p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">PnL %</p>
          <p className={cn('font-medium', pnlPercent >= 0 ? 'text-success' : 'text-danger')}>
            {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">SL</p>
          <p className="font-medium text-danger">${formatPrice(position.stop_loss)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">TP</p>
          <p className="font-medium text-success">${formatPrice(position.take_profit)}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-surface-2 flex justify-end">
        <Button
          onClick={handleClose}
          disabled={closing}
          variant="secondary"
          size="sm"
          className="gap-2 text-danger"
        >
          <XCircle className="w-4 h-4" />
          {closing ? 'Closing...' : 'Close Position'}
        </Button>
      </div>
    </div>
  );
}

function PendingOrderCard({ order, onCancel }: { order: TestnetPendingOrder; onCancel: (id: string) => Promise<any> }) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    await onCancel(order.order_id);
    setCancelling(false);
  };

  const isLong = order.side === 'long';
  const priceDistance = order.entry_price > 0 ? ((order.entry_price - order.stop_loss) / order.entry_price) * 100 : 0;

  return (
    <div className="p-4 bg-surface-1 rounded-lg border border-surface-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant={isLong ? 'success' : 'danger'} className="text-xs">
            {isLong ? 'LONG' : 'SHORT'}
          </Badge>
          <span className="font-medium">{order.symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          {order.binance_order_id && (
            <Badge variant="info" className="text-xs">
              Binance: {order.binance_order_id.slice(0, 8)}...
            </Badge>
          )}
          <Badge variant="neutral" className="text-xs">
            {formatVietnamTime(order.created_at)}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-foreground-tertiary text-xs">Entry Price</p>
          <p className="font-medium">${formatPrice(order.entry_price)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Stop Loss</p>
          <p className="font-medium text-danger">${formatPrice(order.stop_loss)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Take Profit</p>
          <p className="font-medium text-success">${formatPrice(order.take_profit)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Size</p>
          <p className="font-medium">${formatPrice(order.size_usd)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-2">
        <div>
          <p className="text-foreground-tertiary text-xs">Risk</p>
          <p className="font-medium text-danger">${formatPrice(order.risk_usd)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Risk %</p>
          <p className="font-medium">{order.risk_percent.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">R:R Ratio</p>
          <p className="font-medium">{order.expected_rr.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">SL Distance</p>
          <p className="font-medium">{priceDistance.toFixed(2)}%</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-surface-2 flex justify-end">
        <Button
          onClick={handleCancel}
          disabled={cancelling}
          variant="secondary"
          size="sm"
          className="gap-2 text-danger"
        >
          <XCircle className="w-4 h-4" />
          {cancelling ? 'Cancelling...' : 'Cancel Order'}
        </Button>
      </div>
    </div>
  );
}

function TradeHistoryCard({ trade }: { trade: TestnetPosition }) {
  const isLong = trade.side === 'BUY';
  const isWin = trade.realized_pnl >= 0;

  return (
    <div className="p-4 bg-surface-1 rounded-lg border border-surface-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant={isLong ? 'success' : 'danger'} className="text-xs">
            {trade.side}
          </Badge>
          <span className="font-medium">{trade.symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isWin ? 'success' : 'danger'} className="text-xs">
            {isWin ? 'WIN' : 'LOSS'}
          </Badge>
          {trade.close_reason && (
            <Badge variant="neutral" className="text-xs">
              {trade.close_reason}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-foreground-tertiary text-xs">Entry</p>
          <p className="font-medium">${formatPrice(trade.entry_price)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Exit</p>
          <p className="font-medium">${formatPrice(trade.close_price || 0)}</p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Realized PnL</p>
          <p className={cn('font-medium', isWin ? 'text-success' : 'text-danger')}>
            {isWin ? '+' : ''}{formatPrice(trade.realized_pnl)}
          </p>
        </div>
        <div>
          <p className="text-foreground-tertiary text-xs">Closed</p>
          <p className="font-medium">{trade.close_time ? formatVietnamTime(trade.close_time) : '-'}</p>
        </div>
      </div>
    </div>
  );
}
