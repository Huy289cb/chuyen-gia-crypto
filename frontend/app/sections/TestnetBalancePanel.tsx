'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { MetricCard } from '../components/MetricCard';
import { Wallet, TrendingUp, DollarSign } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useAccountData } from '../hooks/useAccountData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PanelErrorState } from '../components/PanelErrorState';
import { EmptyState } from '../components/EmptyState';

interface TestnetBalancePanelProps {
  className?: string;
}

export function TestnetBalancePanel({ className }: TestnetBalancePanelProps) {
  const { data, loading, error } = useAccountData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Testnet Account"
          subtitle="Loading..."
          icon={<Wallet className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Testnet Account"
          subtitle="Error loading data"
          icon={<Wallet className="w-5 h-5" />}
        />
        <PanelErrorState message={error} />
      </Card>
    );
  }

  if (!data?.balance) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Testnet Account"
          subtitle="Error loading data"
          icon={<Wallet className="w-5 h-5" />}
        />
        <PanelErrorState message="Failed to load balance data" />
      </Card>
    );
  }

  const balanceData = {
    ...data.balance,
    dbPositionPnlGap: data.balance.positionTradingPnlGap ?? data.balance.dbPositionPnlGap,
  };
  const unrealizedPnL = balanceData.equity - balanceData.totalBalance;
  const unrealizedFootnote =
    Math.abs(unrealizedPnL) >= 0.01
      ? `${unrealizedPnL >= 0 ? '+' : ''}${formatPrice(unrealizedPnL)} unrealized`
      : undefined;

  if (balanceData.isInitialized === false) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Testnet Account"
          subtitle="Status"
          icon={<Wallet className="w-5 h-5" />}
        />
        <EmptyState
          icon={Wallet}
          title="Account not initialized"
          description="The testnet account for this method has not been set up or connected to a live source yet."
          size="sm"
        />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <SectionHeader
        title="Testnet Account"
        subtitle="Balance and equity"
        icon={<Wallet className="w-5 h-5" />}
      />

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          title="Total Balance"
          value={formatPrice(balanceData.totalBalance)}
          icon={<DollarSign className="w-4 h-4" />}
          size="sm"
          nested
        />
        <MetricCard
          title="Equity"
          value={formatPrice(balanceData.equity)}
          footnote={unrealizedFootnote}
          icon={<TrendingUp className="w-4 h-4" />}
          trend={
            unrealizedFootnote
              ? unrealizedPnL >= 0
                ? 'up'
                : 'down'
              : 'neutral'
          }
          size="sm"
          nested
        />
        <MetricCard
          title="Available"
          value={formatPrice(balanceData.availableBalance)}
          size="sm"
          nested
        />
        <MetricCard
          title="Used Margin"
          value={formatPrice(balanceData.usedMargin)}
          size="sm"
          nested
        />
      </div>

      <div className="mt-4 pt-4 border-t border-border-default space-y-3">
        {typeof balanceData.walletPnl === 'number' && (
          <div className="panel-stat panel-stat-accent">
            <p className="text-xs text-foreground-tertiary mb-1">Lãi/lỗ ví (Binance)</p>
            <p
              className={cn(
                'text-base font-mono font-semibold',
                balanceData.walletPnl >= 0 ? 'text-success' : 'text-danger'
              )}
            >
              {balanceData.walletPnl >= 0 ? '+' : ''}
              {formatPrice(balanceData.walletPnl)}
            </p>
            {typeof balanceData.binanceRealizedPnl === 'number' && (
              <p className="text-xs text-foreground-tertiary mt-1">
                Lãi/lỗ đã chốt (Binance): {formatPrice(balanceData.binanceRealizedPnl)}
                {typeof balanceData.totalFees === 'number' && balanceData.totalFees > 0
                  ? ` · Fees ${formatPrice(balanceData.totalFees)}`
                  : ''}
                {typeof balanceData.fundingFees === 'number' && balanceData.fundingFees !== 0
                  ? ` · Funding ${formatPrice(balanceData.fundingFees)}`
                  : ''}
              </p>
            )}
            {balanceData.dbPositionPnlTrusted === false &&
              (typeof balanceData.positionTradingPnlGap === 'number' ||
                typeof balanceData.dbPositionPnlGap === 'number') && (
                <p className="text-xs text-amber-500/90 mt-1">
                  Sổ lệnh bot lệch {formatPrice(balanceData.dbPositionPnlGap)} — lấy số ví làm chuẩn
                </p>
              )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Daily PnL (ICT)</p>
            <p
              className={cn(
                'text-sm font-mono font-semibold',
                balanceData.dailyPnL >= 0 ? 'text-success' : 'text-danger'
              )}
            >
              {balanceData.dailyPnL >= 0 ? '+' : ''}
              {formatPrice(balanceData.dailyPnL)}
            </p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">7-day PnL</p>
            <p
              className={cn(
                'text-sm font-mono font-semibold',
                balanceData.weeklyPnL >= 0 ? 'text-success' : 'text-danger'
              )}
            >
              {balanceData.weeklyPnL >= 0 ? '+' : ''}
              {formatPrice(balanceData.weeklyPnL)}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
