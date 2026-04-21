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
  method?: string;
}

export function TradingDashboard({ accounts, loading, onReset, method = 'ict' }: TradingDashboardProps) {
  const methodName = method === 'ict' ? 'ICT Method' : 'Kim Nghia Method';
  const btcAccount = accounts.find(a => a.symbol === 'BTC' && a.method_id === method);
  
  // Focus on BTC-only metrics since ETH trading is disabled
  const btcEquity = btcAccount?.equity || 0;
  const btcStarting = btcAccount?.starting_balance || 100;
  const btcReturn = btcStarting > 0 ? ((btcEquity - btcStarting) / btcStarting) * 100 : 0;
  const btcRealizedPnl = btcAccount?.realized_pnl || 0;
  const btcTrades = btcAccount?.total_trades || 0;
  const btcWins = btcAccount?.winning_trades || 0;
  const btcWinRate = btcTrades > 0 ? ((btcWins / btcTrades) * 100).toFixed(0) : '0';

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Paper Trading Dashboard</h2>
          <Badge variant="default" size="sm">{methodName}</Badge>
        </div>
        <div className="flex gap-2">
          {/* <Button 
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
          </Button> */}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* BTC Equity */}
        <StatCard
          title="BTC Equity"
          value={`$${formatPrice(btcEquity)}`}
          subtitle={`${btcRealizedPnl >= 0 ? '+' : ''}$${formatPrice(btcRealizedPnl)} PnL`}
          subtitleColor={btcRealizedPnl >= 0 ? 'text-success' : 'text-danger'}
          icon={<DollarSign className="w-4 h-4 text-btc" />}
        />

        {/* BTC Return */}
        <StatCard
          title="BTC Return"
          value={`${btcReturn >= 0 ? '+' : ''}${btcReturn.toFixed(2)}%`}
          subtitle={`$${formatPrice(btcEquity)} / $${formatPrice(btcStarting)}`}
          subtitleColor="text-foreground-tertiary"
          icon={btcReturn >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-danger" />}
          valueColor={btcReturn >= 0 ? 'text-success' : 'text-danger'}
        />

        {/* BTC Trades */}
        <StatCard
          title="BTC Trades"
          value={btcTrades.toString()}
          subtitle={`Win Rate: ${btcWinRate}%`}
          subtitleColor="text-foreground-tertiary"
          icon={<Activity className="w-4 h-4 text-accent-primary" />}
        />

        {/* Position Limit */}
        <StatCard
          title="Max Positions"
          value="6"
          subtitle="Per symbol concurrent limit"
          subtitleColor="text-foreground-tertiary"
          icon={<DollarSign className="w-4 h-4 text-info" />}
        />
      </div>

      {/* BTC Cooldown Alert */}
      {btcAccount?.cooldown_until && new Date(btcAccount.cooldown_until) > new Date() && (() => {
        const minutesLeft = Math.ceil((new Date(btcAccount.cooldown_until!).getTime() - Date.now()) / 60000);
        return (
          <div className="mt-4 p-3 rounded-lg bg-warning-dim border border-warning/20">
            <div className="flex items-center gap-2">
              <Badge variant="warning">COOLDOWN</Badge>
              <span className="text-sm text-warning">
                BTC account in cooldown for {minutesLeft} minutes (3 consecutive losses)
              </span>
            </div>
          </div>
        );
      })()}
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
