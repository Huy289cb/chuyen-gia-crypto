'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { ShieldAlert, Lock } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useIntelligenceData } from '../hooks/useIntelligenceData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PanelErrorState } from '../components/PanelErrorState';

interface RiskEnginePanelProps {
  className?: string;
}

export function RiskEnginePanel({ className }: RiskEnginePanelProps) {
  const { data, loading, error } = useIntelligenceData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Risk Engine"
          subtitle="Loading..."
          icon={<ShieldAlert className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Risk Engine"
          subtitle="Error loading data"
          icon={<ShieldAlert className="w-5 h-5" />}
        />
        <PanelErrorState message={error} />
      </Card>
    );
  }

  if (!data?.riskEngine) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Risk Engine"
          subtitle="Risk state unavailable"
          icon={<ShieldAlert className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-foreground-secondary">Could not load risk engine state.</div>
      </Card>
    );
  }

  const riskData = data.riskEngine;
  const isLocked = riskData.currentLockState !== 'unlocked';

  return (
    <Card className={className}>
      <SectionHeader
        title="Risk Engine"
        subtitle="Risk controls and limits"
        icon={<ShieldAlert className="w-5 h-5" />}
      />

      <div className="space-y-4">
        {/* Lock Status */}
        <div className={cn(
          'flex items-center justify-between p-3 rounded-lg',
          isLocked ? 'bg-danger-dim' : 'bg-success-dim'
        )}>
          <div className="flex items-center gap-2">
            {isLocked ? (
              <Lock className="w-5 h-5 text-danger" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-success" />
            )}
            <span className={cn(
              'text-sm font-medium',
              isLocked ? 'text-danger' : 'text-success'
            )}>
              {isLocked ? 'Trading Locked' : 'Trading Unlocked'}
            </span>
          </div>
          <StatusBadge
            status={isLocked ? 'blocked' : 'trading_enabled'}
            size="sm"
          />
        </div>

        {isLocked && (riskData.lockReason || riskData.allowedReason) && (
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Lock Reason</p>
            <p className="text-sm text-foreground">{riskData.lockReason || riskData.allowedReason}</p>
          </div>
        )}

        <div className="panel-stat">
          <p className="text-xs text-foreground-tertiary mb-1">Today&apos;s drawdown (realized vs day open)</p>
          <p className="text-sm font-mono text-foreground break-words leading-relaxed">
            {formatPrice(riskData.dailyLossCurrent ?? 0)} / {formatPrice(riskData.dailyLossCap)}
            {typeof riskData.dailyLossLimitPercent === 'number' && (
              <span className="text-foreground-tertiary text-xs block sm:inline sm:ml-2 mt-0.5 sm:mt-0">
                ({riskData.dailyLossLimitPercent}% of balance cap)
              </span>
            )}
          </p>
        </div>

        {/* Risk Parameters */}
        <div className="grid grid-cols-2 gap-3">
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Risk Per Trade</p>
            <p className="text-lg font-semibold text-foreground">{riskData.riskPerTrade.toFixed(2)}%</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Daily Loss Cap</p>
            <p className="text-lg font-semibold text-foreground">{formatPrice(riskData.dailyLossCap)}</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Max Consecutive Losses</p>
            <p className="text-lg font-semibold text-foreground">{riskData.maxConsecutiveLosses}</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Current Streak</p>
            <p className={cn(
              'text-lg font-semibold',
              riskData.currentStreak >= riskData.maxConsecutiveLosses ? 'text-danger' : 'text-foreground'
            )}>
              {riskData.currentStreak} / {riskData.maxConsecutiveLosses}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
