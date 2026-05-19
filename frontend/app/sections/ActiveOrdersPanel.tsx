'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { StatusBadge } from '../components/StatusBadge';
import { SideChip } from '../components/SideChip';
import { ShoppingBag, Clock } from 'lucide-react';
import { cn, formatPositionSize, formatPrice, formatVietnamTime } from '@/lib/utils';
import { useAccountData } from '../hooks/useAccountData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface ActiveOrdersPanelProps {
  className?: string;
}

export function ActiveOrdersPanel({ className }: ActiveOrdersPanelProps) {
  const { data, loading, error } = useAccountData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Active Orders"
          subtitle="Loading..."
          icon={<ShoppingBag className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Active Orders"
          subtitle="Error loading data"
          icon={<ShoppingBag className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-red-500">{error}</div>
      </Card>
    );
  }

  const orders = data?.orders || [];

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
                <SideChip side={order.side} />
                <span className="text-xs text-foreground-tertiary">{order.type}</span>
              </div>
              <StatusBadge
                status={order.status === 'pending' ? 'healthy' : 'trading_paused'}
                label={order.status.toUpperCase()}
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
                <span className="ml-1 font-mono text-foreground">{formatPositionSize(order.quantity)}</span>
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
