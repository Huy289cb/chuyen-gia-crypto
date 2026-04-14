'use client';

import { DollarSign, TrendingUp, TrendingDown, Activity, RotateCcw } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { cn, formatPrice } from '@/lib/utils';
import type { TradingAccount } from '../types';

interface TradingDashboardProps {
  accounts: TradingAccount[];
  loading?: boolean;
  onReset: (symbol: string) => Promise<{ success: boolean; error?: string }>;
}

export function TradingDashboard({ accounts, loading, onReset }: TradingDashboardProps) {
  const btcAccount = accounts.find(a => a.symbol === 'BTC');
  const ethAccount = accounts.find(a => a.symbol === 'ETH');

  const totalEquity = accounts.reduce((sum, acc) => sum + (acc.equity || 0), 0);
  const totalStarting = accounts.reduce((sum, acc) => sum + (acc.starting_balance || 0), 0);
  const totalReturn = totalStarting > 0 ? ((totalEquity - totalStarting) / totalStarting) * 100 : 0;
  const totalRealizedPnl = accounts.reduce((sum, acc) => sum + (acc.realized_pnl || 0), 0);
  const totalTrades = accounts.reduce((sum, acc) => sum + (acc.total_trades || 0), 0);
  
  const totalWins = accounts.reduce((sum, acc) => sum + (acc.winning_trades || 0), 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(0) : '0';

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Paper Trading Dashboard</h2>
        <div className="flex gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            leftIcon={<RotateCcw size={14} />}
            onClick={() => onReset('BTC')}
          >
            Reset BTC
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            leftIcon={<RotateCcw size={14} />}
            onClick={() => onReset('ETH')}
          >
            Reset ETH
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* BTC Equity */}
        <StatCard
          title="BTC Equity"
          value={`$${formatPrice(btcAccount?.equity || 0)}`}
          subtitle={`${btcAccount && btcAccount.realized_pnl >= 0 ? '+' : ''}$${formatPrice(btcAccount?.realized_pnl || 0)} PnL`}
          subtitleColor={btcAccount && btcAccount.realized_pnl >= 0 ? 'text-success' : 'text-danger'}
          icon={<DollarSign className="w-4 h-4 text-btc" />}
        />

        {/* ETH Equity */}
        <StatCard
          title="ETH Equity"
          value={`$${formatPrice(ethAccount?.equity || 0)}`}
          subtitle={`${ethAccount && ethAccount.realized_pnl >= 0 ? '+' : ''}$${formatPrice(ethAccount?.realized_pnl || 0)} PnL`}
          subtitleColor={ethAccount && ethAccount.realized_pnl >= 0 ? 'text-success' : 'text-danger'}
          icon={<DollarSign className="w-4 h-4 text-eth" />}
        />

        {/* Total Return */}
        <StatCard
          title="Total Return"
          value={`${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`}
          subtitle={`$${formatPrice(totalEquity)} / $${formatPrice(totalStarting)}`}
          subtitleColor="text-foreground-tertiary"
          icon={totalReturn >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-danger" />}
          valueColor={totalReturn >= 0 ? 'text-success' : 'text-danger'}
        />

        {/* Total Trades */}
        <StatCard
          title="Total Trades"
          value={totalTrades.toString()}
          subtitle={`Win Rate: ${winRate}%`}
          subtitleColor="text-foreground-tertiary"
          icon={<Activity className="w-4 h-4 text-accent-primary" />}
        />
      </div>

      {/* Cooldown Alert */}
      {accounts.map(account => {
        if (account.cooldown_until && new Date(account.cooldown_until) > new Date()) {
          const minutesLeft = Math.ceil((new Date(account.cooldown_until).getTime() - Date.now()) / 60000);
          return (
            <div key={account.symbol} className="mt-4 p-3 rounded-lg bg-warning-dim border border-warning/20">
              <div className="flex items-center gap-2">
                <Badge variant="warning">COOLDOWN</Badge>
                <span className="text-sm text-warning">
                  {account.symbol} account in cooldown for {minutesLeft} minutes (3 consecutive losses)
                </span>
              </div>
            </div>
          );
        }
        return null;
      })}
    </section>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  subtitleColor: string;
  icon: React.ReactNode;
  valueColor?: string;
}

function StatCard({ title, value, subtitle, subtitleColor, icon, valueColor = 'text-foreground' }: StatCardProps) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs sm:text-sm font-medium text-foreground-secondary">{title}</span>
        {icon}
      </div>
      <div className={cn('text-lg sm:text-xl font-bold font-mono', valueColor)}>
        {value}
      </div>
      <div className={cn('text-xs', subtitleColor)}>
        {subtitle}
      </div>
    </Card>
  );
}
