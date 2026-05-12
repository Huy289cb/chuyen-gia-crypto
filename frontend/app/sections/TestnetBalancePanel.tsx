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

  if (error || !data?.balance) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Testnet Account"
          subtitle="Error loading data"
          icon={<Wallet className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-red-500">{error || 'Failed to load balance data'}</div>
      </Card>
    );
  }

  const balanceData = data.balance;

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
        />
        <MetricCard
          title="Equity"
          value={formatPrice(balanceData.equity)}
          change={((balanceData.equity - balanceData.totalBalance) / balanceData.totalBalance) * 100}
          changeLabel="vs balance"
          icon={<TrendingUp className="w-4 h-4" />}
          trend={balanceData.equity >= balanceData.totalBalance ? 'up' : 'down'}
          size="sm"
        />
        <MetricCard
          title="Available"
          value={formatPrice(balanceData.availableBalance)}
          size="sm"
        />
        <MetricCard
          title="Used Margin"
          value={formatPrice(balanceData.usedMargin)}
          size="sm"
        />
      </div>

      <div className="mt-4 pt-4 border-t border-border-default grid grid-cols-2 gap-3">
        <div className="p-3 bg-surface-1/50 rounded-lg">
          <p className="text-xs text-foreground-tertiary mb-1">Daily PnL</p>
          <p className={cn(
            'text-sm font-mono font-semibold',
            balanceData.dailyPnL >= 0 ? 'text-success' : 'text-danger'
          )}>
            {balanceData.dailyPnL >= 0 ? '+' : ''}{formatPrice(balanceData.dailyPnL)}
          </p>
        </div>
        <div className="p-3 bg-surface-1/50 rounded-lg">
          <p className="text-xs text-foreground-tertiary mb-1">Weekly PnL</p>
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
