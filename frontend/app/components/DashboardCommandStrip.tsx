'use client';

import Link from 'next/link';
import {
  Activity,
  GitBranch,
  Signal,
  Target,
  Wallet,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { useV3Dashboard } from '../contexts/V3DashboardDataContext';
import { useDecisionFlow } from '../hooks/useDecisionFlow';
import { LoadingSkeleton } from './LoadingSkeleton';

function StripCell({
  label,
  children,
  href,
  accent,
  className,
}: {
  label: string;
  children: React.ReactNode;
  href?: string;
  accent?: boolean;
  className?: string;
}) {
  const inner = (
    <div
      className={cn(
        'panel-stat min-h-[4.5rem] flex flex-col justify-between',
        accent && 'panel-stat-accent',
        href && 'hover:border-border-strong transition-colors',
        className
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-foreground-tertiary">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block min-w-0">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function DashboardCommandStrip() {
  const { summary, account, intelligence } = useV3Dashboard();
  const flow = useDecisionFlow();

  const loading = summary.loading || account.loading || intelligence.loading || flow.loading;

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <LoadingSkeleton key={i} variant="card" height="4.5rem" />
        ))}
      </div>
    );
  }

  const balance = account.data?.balance;
  const positions = account.data?.positions ?? [];
  const signal = intelligence.data?.signalGate;
  const workerOk = summary.data?.systemHealth.workerStatus === 'healthy';

  const unrealizedTotal = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
  const confidencePct =
    signal && signal.confidence > 0 && signal.confidence <= 1
      ? Math.round(signal.confidence * 100)
      : signal
        ? Math.round(signal.confidence)
        : null;

  const blockedHint =
    flow.blockedReason && flow.blockedReason !== 'No active block — pipeline clear'
      ? flow.blockedReason
      : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StripCell label="Pipeline" href="#pipeline" accent>
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">
              {flow.currentStageLabel}
            </span>
          </div>
          <div className="mt-1.5 progress-track">
            <div className="progress-fill" style={{ width: `${flow.readinessScore}%` }} />
          </div>
          <p className="text-[10px] text-foreground-tertiary tabular-nums mt-1">
            {flow.readinessScore}% sẵn sàng
          </p>
        </StripCell>

        <StripCell label="Signal Gate" href="#signal-gate" accent={signal?.pass === true}>
          <div className="flex items-center gap-1.5">
            <Signal
              className={cn(
                'w-3.5 h-3.5 shrink-0',
                signal?.pass ? 'text-success' : signal ? 'text-danger' : 'text-foreground-tertiary'
              )}
            />
            <span
              className={cn(
                'text-sm font-semibold',
                signal?.pass ? 'text-success' : signal ? 'text-danger' : 'text-foreground-tertiary'
              )}
            >
              {signal ? (signal.pass ? 'PASS' : 'BLOCK') : '—'}
            </span>
          </div>
          {signal && (
            <p className="text-[10px] text-foreground-secondary mt-1 truncate">
              Grade {signal.grade}
              {confidencePct != null ? ` · ${confidencePct}%` : ''}
              {signal.timeframe ? ` · ${signal.timeframe}` : ''}
            </p>
          )}
        </StripCell>

        <StripCell label="Vị thế mở" href="#open-positions">
          <div className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {positions.length}
            </span>
          </div>
          {positions.length > 0 && (
            <p
              className={cn(
                'text-[10px] font-mono font-medium mt-1 tabular-nums',
                unrealizedTotal >= 0 ? 'text-success' : 'text-danger'
              )}
            >
              {unrealizedTotal >= 0 ? '+' : ''}
              {formatPrice(unrealizedTotal)} uPnL
            </p>
          )}
        </StripCell>

        <StripCell label="Equity" href="#execution">
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-accent-primary shrink-0" />
            <span className="text-sm font-mono font-semibold text-foreground tabular-nums truncate">
              {balance?.isInitialized !== false && balance
                ? formatPrice(balance.equity)
                : '—'}
            </span>
          </div>
          {balance?.isInitialized !== false && balance && (
            <p className="text-[10px] text-foreground-tertiary mt-1 truncate">
              Khả dụng {formatPrice(balance.availableBalance)}
            </p>
          )}
        </StripCell>

        <StripCell label="PnL hôm nay" href="#execution">
          <div className="flex items-center gap-1.5">
            <TrendingUp
              className={cn(
                'w-3.5 h-3.5 shrink-0',
                balance && balance.dailyPnL >= 0 ? 'text-success' : 'text-danger'
              )}
            />
            <span
              className={cn(
                'text-sm font-mono font-semibold tabular-nums',
                balance && balance.dailyPnL >= 0 ? 'text-success' : 'text-danger'
              )}
            >
              {balance?.isInitialized !== false && balance
                ? `${balance.dailyPnL >= 0 ? '+' : ''}${formatPrice(balance.dailyPnL)}`
                : '—'}
            </span>
          </div>
          {balance?.isInitialized !== false && balance && (
            <p className="text-[10px] text-foreground-tertiary mt-1 tabular-nums">
              7 ngày: {balance.weeklyPnL >= 0 ? '+' : ''}
              {formatPrice(balance.weeklyPnL)}
            </p>
          )}
        </StripCell>

        <StripCell label="Worker">
          <div className="flex items-center gap-1.5">
            <Activity
              className={cn('w-3.5 h-3.5 shrink-0', workerOk ? 'text-success' : 'text-warning')}
            />
            <span
              className={cn(
                'text-sm font-semibold',
                workerOk ? 'text-success' : 'text-warning'
              )}
            >
              {workerOk ? 'Healthy' : summary.data?.systemHealth.workerStatus ?? 'Unknown'}
            </span>
          </div>
          <p className="text-[10px] text-foreground-tertiary mt-1 truncate">
            {summary.data?.systemHealth.lockStatus === 'unlocked' ? 'Trading unlocked' : 'Locked'}
          </p>
        </StripCell>
      </div>

      {blockedHint && (
        <div
          className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning-dim border border-warning/20 text-xs text-foreground-secondary"
          role="status"
        >
          <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
          <span>
            <span className="font-medium text-warning">Đang chặn: </span>
            {blockedHint}
          </span>
        </div>
      )}
    </div>
  );
}
