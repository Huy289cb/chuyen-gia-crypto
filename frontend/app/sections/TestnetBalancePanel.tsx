'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { MetricCard } from '../components/MetricCard';
import { Wallet, TrendingUp, DollarSign } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useAccountData } from '../hooks/useAccountData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

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
        <div className="p-4 text-sm text-red-500">{error}</div>
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
        <div className="p-4 text-sm text-red-500">Failed to load balance data</div>
      </Card>
    );
  }

  const balanceData = data.balance;
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
        <div className="p-8 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
            <Wallet className="w-6 h-6 text-foreground-tertiary" />
          </div>
          <p className="text-sm font-medium text-foreground-secondary mb-1">Account Not Initialized</p>
          <p className="text-xs text-foreground-tertiary max-w-[200px]">
            The testnet account for this method has not been set up or connected to a live source yet.
          </p>
        </div>
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

      <div className="mt-4 pt-4 border-t border-border-default grid grid-cols-2 gap-3">
        <div className="p-3 bg-surface-1/50 rounded-lg">
          <p className="text-xs text-foreground-tertiary mb-1">Daily PnL (UTC)</p>
          <p className={cn(
            'text-sm font-mono font-semibold',
            balanceData.dailyPnL >= 0 ? 'text-success' : 'text-danger'
          )}>
            {balanceData.dailyPnL >= 0 ? '+' : ''}{formatPrice(balanceData.dailyPnL)}
          </p>
        </div>
        <div className="p-3 bg-surface-1/50 rounded-lg">
          <p className="text-xs text-foreground-tertiary mb-1">7-day PnL</p>
          <p className={cn(
            'text-sm font-mono font-semibold',
            balanceData.weeklyPnL >= 0 ? 'text-success' : 'text-danger'
          )}>
            {balanceData.weeklyPnL >= 0 ? '+' : ''}{formatPrice(balanceData.weeklyPnL)}
          </p>
        </div>
      </div>
    </Card>
  );
}
