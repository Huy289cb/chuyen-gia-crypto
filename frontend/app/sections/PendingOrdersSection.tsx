'use client';

import { useState, useEffect } from 'react';
import { Clock, X, Target, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { cn, formatPrice } from '@/lib/utils';
import { formatToGMT7 } from '@/lib/dateHelpers';
import type { PendingOrder, ApiResponse } from '../types';

interface PendingOrdersSectionProps {
  symbol?: string;
  method?: string;
}

export function PendingOrdersSection({ symbol, method = 'kim_nghia' }: PendingOrdersSectionProps) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const API_BASE = process.env.NODE_ENV === 'development' 
    ? 'http://localhost:3000/api' 
    : '/api';

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const params = new URLSearchParams();
        if (symbol) params.set('symbol', symbol);
        if (method) params.set('method', method);
        const url = `${API_BASE}/pending-orders?${params.toString()}`;
        const response = await fetch(url);
        const data: ApiResponse<PendingOrder[]> = await response.json();
        if (data.success && data.data) {
          // Only show pending orders
          const pending = data.data.filter(o => o.status === 'pending');
          setOrders(pending);
        }
      } catch (err) {
        console.error('Error fetching pending orders:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
    // Refresh every 10 seconds
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [symbol, method, API_BASE]);

  const cancelOrder = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      const response = await fetch(`${API_BASE}/pending-orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' })
      });
      const data = await response.json();
      if (data.success) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      }
    } catch (err) {
      console.error('Error cancelling order:', err);
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Pending Orders" 
          subtitle="Loading..."
          icon={<Clock className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <div className="animate-pulse space-y-3 p-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 bg-surface-1 rounded-lg" />
            ))}
          </div>
        </Card>
      </section>
    );
  }

  if (orders.length === 0) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Pending Orders" 
          subtitle={`${symbol || 'All'} limit orders waiting to execute`}
          icon={<Clock className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <p className="text-foreground-tertiary text-sm text-center py-8">
            No pending limit orders. New orders will appear when auto-entry conditions are met.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <CardHeader 
        title={`Pending Orders (${orders.length})`}
        subtitle={`${symbol || 'All'} limit orders waiting for price to hit entry`}
        icon={<Clock className="w-5 h-5" />}
      />
      
      <Card className="mt-4 overflow-hidden" padding="none">
        {/* Desktop Table */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-1 border-b border-border-default">
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-secondary">Symbol</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-foreground-secondary">Side</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Entry</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">SL</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">TP</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Size</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Risk</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">R:R</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-foreground-secondary">Created</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-foreground-secondary">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr 
                  key={order.id} 
                  className={cn(
                    'border-b border-border-subtle last:border-0',
                    'hover:bg-surface-1/50 transition-colors'
                  )}
                >
                  <td className="px-4 py-3">
                    <span className="font-bold text-foreground">{order.symbol}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={order.side === 'long' ? 'success' : 'danger'} size="sm">
                      {order.side.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    ${formatPrice(order.entry_price)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-danger">
                    ${formatPrice(order.stop_loss)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-success">
                    ${formatPrice(order.take_profit)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    ${formatPrice(order.size_usd)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn(
                      'font-mono text-xs',
                      order.risk_percent > 2 ? 'text-warning' : 'text-foreground-secondary'
                    )}>
                      {order.risk_percent.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-foreground">
                    {order.expected_rr.toFixed(1)}R
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-foreground-secondary">
                    {formatToGMT7(order.created_at, order.executed_at)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelOrder(order.id)}
                      disabled={cancellingId === order.id}
                      className="text-danger hover:text-danger hover:bg-danger-dim"
                    >
                      <X size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="sm:hidden divide-y divide-border-subtle">
          {orders.map((order) => (
            <OrderCardMobile 
              key={order.id} 
              order={order} 
              onCancel={() => cancelOrder(order.id)}
              isCancelling={cancellingId === order.id}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

function OrderCardMobile({ 
  order, 
  onCancel,
  isCancelling
}: { 
  order: PendingOrder;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const SideIcon = order.side === 'long' ? TrendingUp : TrendingDown;
  
  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground">{order.symbol}</span>
          <Badge variant={order.side === 'long' ? 'success' : 'danger'} size="sm">
            <SideIcon size={12} className="mr-1" />
            {order.side.toUpperCase()}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-tertiary">
            {formatToGMT7(order.created_at, order.executed_at)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isCancelling}
            className="text-danger hover:text-danger hover:bg-danger-dim p-1"
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* Price levels */}
      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div className="bg-surface-1 rounded-lg p-2 text-center">
          <div className="text-foreground-tertiary mb-1">Entry</div>
          <div className="font-mono font-medium text-foreground">${formatPrice(order.entry_price)}</div>
        </div>
        <div className="bg-danger-dim rounded-lg p-2 text-center">
          <div className="text-danger mb-1">SL</div>
          <div className="font-mono font-medium text-danger">${formatPrice(order.stop_loss)}</div>
        </div>
        <div className="bg-success-dim rounded-lg p-2 text-center">
          <div className="text-success mb-1">TP</div>
          <div className="font-mono font-medium text-success">${formatPrice(order.take_profit)}</div>
        </div>
      </div>

      {/* Size & Risk */}
      <div className="flex items-center justify-between text-xs">
        <div>
          <span className="text-foreground-tertiary">Size: </span>
          <span className="font-mono text-foreground">${formatPrice(order.size_usd)}</span>
        </div>
        <div>
          <span className="text-foreground-tertiary">Risk: </span>
          <span className={cn(
            'font-mono',
            order.risk_percent > 2 ? 'text-warning' : 'text-foreground-secondary'
          )}>
            {order.risk_percent.toFixed(2)}%
          </span>
        </div>
        <div>
          <span className="text-foreground-tertiary">R:R </span>
          <span className="font-mono text-foreground">{order.expected_rr.toFixed(1)}R</span>
        </div>
      </div>

      {/* Invalidation warning */}
      {order.invalidation_level && (
        <div className="mt-3 flex items-center gap-2 text-xs text-warning bg-warning-dim rounded-lg px-2 py-1">
          <AlertTriangle size={12} />
          <span>Invalidates below ${formatPrice(order.invalidation_level)}</span>
        </div>
      )}
    </div>
  );
}
