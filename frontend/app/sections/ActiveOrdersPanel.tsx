'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { ShoppingBag, Clock } from 'lucide-react';
import { cn, formatPrice, formatVietnamTime } from '@/lib/utils';

interface ActiveOrdersPanelProps {
  className?: string;
}

export function ActiveOrdersPanel({ className }: ActiveOrdersPanelProps) {
  // TODO: Replace with actual data from API
  const orders = [
    {
      id: '12345',
      symbol: 'BTC',
      side: 'BUY' as const,
      type: 'LIMIT' as const,
      status: 'NEW' as const,
      price: 94000,
      quantity: 0.1,
      reduceOnly: false,
      createdAt: new Date(Date.now() - 300000).toISOString(),
    },
  ];

  if (orders.length === 0) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Active Orders"
          subtitle="Pending orders"
          icon={<ShoppingBag className="w-5 h-5" />}
        />
        <EmptyState
          title="No Active Orders"
          description="You have no pending orders at the moment."
          size="sm"
        />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <SectionHeader
        title="Active Orders"
        subtitle={`Pending: ${orders.length}`}
        icon={<ShoppingBag className="w-5 h-5" />}
      />
      
      <div className="space-y-3">
        {orders.map((order) => (
          <div 
            key={order.id}
            className="p-3 bg-surface-1/50 rounded-lg space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{order.symbol}</span>
                <StatusBadge 
                  status={order.side === 'BUY' ? 'trading_enabled' : 'blocked'}
                  label={order.side}
                  size="sm"
                />
                <span className="text-xs text-foreground-tertiary">{order.type}</span>
              </div>
              <StatusBadge 
                status={order.status === 'NEW' ? 'healthy' : 'trading_paused'}
                label={order.status}
                size="sm"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-foreground-tertiary">Price:</span>
                <span className="ml-1 font-mono text-foreground">{formatPrice(order.price)}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">Qty:</span>
                <span className="ml-1 font-mono text-foreground">{order.quantity}</span>
              </div>
              <div>
                <span className="text-foreground-tertiary">ID:</span>
                <span className="ml-1 font-mono text-foreground-tertiary">{order.id}</span>
              </div>
              <div className="flex items-center gap-1 text-foreground-tertiary">
                <Clock className="w-3 h-3" />
                {formatVietnamTime(order.createdAt)}
              </div>
            </div>

            {order.reduceOnly && (
              <div className="pt-2 border-t border-border-default">
                <span className="text-xs text-foreground-tertiary">Reduce Only</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
