'use client';

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Percent, Activity, DollarSign, Award } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { cn, formatPrice } from '@/lib/utils';
import type { PerformanceMetrics, ApiResponse } from '../types';

interface PerformanceSectionProps {
  symbol: string;
}

export function PerformanceSection({ symbol }: PerformanceSectionProps) {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const API_BASE = process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3000/api' 
          : '/api';
        const response = await fetch(`${API_BASE}/performance?symbol=${symbol}`);
        const data: ApiResponse<PerformanceMetrics> = await response.json();
        if (data.success && data.data) {
          setMetrics(data.data);
        }
      } catch (err) {
        console.error('Error fetching metrics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [symbol]);

  if (loading) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Performance Metrics" 
          subtitle="Loading..."
          icon={<BarChart3 className="w-5 h-5" />}
        />
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="h-24 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (!metrics || metrics.total_trades === 0) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Performance Metrics" 
          subtitle={`${symbol} trading statistics`}
          icon={<BarChart3 className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <p className="text-foreground-tertiary text-sm text-center py-8">
            No trading data available. Start trading to see performance metrics.
          </p>
        </Card>
      </section>
    );
  }

  const isProfitable = metrics.total_return_percent >= 0;

  return (
    <section className="mb-8">
      <CardHeader 
        title="Performance Metrics"
        subtitle={`${symbol} detailed statistics`}
        icon={<BarChart3 className="w-5 h-5" />}
      />
      
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Return */}
        <MetricCard
          title="Total Return"
          value={`${isProfitable ? '+' : ''}${metrics.total_return_percent.toFixed(2)}%`}
          subtitle={`$${formatPrice(metrics.current_equity)}`}
          icon={<TrendingUp className={cn('w-4 h-4', isProfitable ? 'text-success' : 'text-danger')} />}
          valueColor={isProfitable ? 'text-success' : 'text-danger'}
        />

        {/* Win Rate */}
        <MetricCard
          title="Win Rate"
          value={`${metrics.win_rate.toFixed(1)}%`}
          subtitle={`${metrics.winning_trades}W / ${metrics.losing_trades}L`}
          icon={<Percent className="w-4 h-4 text-accent-primary" />}
        />

        {/* Profit Factor */}
        <MetricCard
          title="Profit Factor"
          value={metrics.profit_factor?.toFixed(2) || '0.00'}
          subtitle="Gross Profit / Loss"
          icon={<Activity className="w-4 h-4 text-info" />}
          valueColor={metrics.profit_factor >= 1 ? 'text-success' : 'text-danger'}
        />

        {/* Max Drawdown */}
        <MetricCard
          title="Max Drawdown"
          value={`${metrics.max_drawdown?.toFixed(2) || '0.00'}%`}
          subtitle="Peak to Trough"
          icon={<TrendingUp className="w-4 h-4 text-warning" />}
          valueColor="text-warning"
        />

        {/* Realized PnL */}
        <MetricCard
          title="Realized PnL"
          value={`${metrics.realized_pnl >= 0 ? '+' : ''}$${formatPrice(metrics.realized_pnl)}`}
          subtitle="Closed Positions"
          icon={<DollarSign className={cn('w-4 h-4', metrics.realized_pnl >= 0 ? 'text-success' : 'text-danger')} />}
          valueColor={metrics.realized_pnl >= 0 ? 'text-success' : 'text-danger'}
        />

        {/* Average R */}
        <MetricCard
          title="Average R"
          value={`${metrics.avg_r_multiple?.toFixed(2) || '0.00'}R`}
          subtitle="Per Trade"
          icon={<Award className="w-4 h-4 text-accent-primary" />}
          valueColor={metrics.avg_r_multiple >= 0 ? 'text-success' : 'text-danger'}
        />

        {/* Total Trades */}
        <MetricCard
          title="Total Trades"
          value={metrics.total_trades.toString()}
          subtitle="Completed"
          icon={<Activity className="w-4 h-4 text-info" />}
        />

        {/* Starting Balance */}
        <MetricCard
          title="Starting Balance"
          value={`$${formatPrice(metrics.starting_balance)}`}
          subtitle="Initial"
          icon={<DollarSign className="w-4 h-4 text-foreground-tertiary" />}
        />
      </div>
    </section>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  valueColor?: string;
}

function MetricCard({ title, value, subtitle, icon, valueColor = 'text-foreground' }: MetricCardProps) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs sm:text-sm font-medium text-foreground-secondary">{title}</span>
        {icon}
      </div>
      <div className={cn('text-lg sm:text-xl font-bold font-mono', valueColor)}>
        {value}
      </div>
      <div className="text-xs text-foreground-tertiary">
        {subtitle}
      </div>
    </Card>
  );
}
