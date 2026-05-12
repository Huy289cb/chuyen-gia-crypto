'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { ShieldAlert, TrendingDown, Lock } from 'lucide-react';
import { formatPrice, formatPercentage } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface RiskEnginePanelProps {
  className?: string;
}

export function RiskEnginePanel({ className }: RiskEnginePanelProps) {
  // TODO: Replace with actual data from API
  const riskData = {
    riskPerTrade: 1.0,
    dailyLossCap: 500,
    maxConsecutiveLosses: 3,
    currentStreak: 0,
    currentLockState: 'unlocked' as const,
    allowedReason: null as string | null,
  };

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

        {isLocked && riskData.allowedReason && (
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Lock Reason</p>
            <p className="text-sm text-foreground">{riskData.allowedReason}</p>
          </div>
        )}

        {/* Risk Parameters */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Risk Per Trade</p>
            <p className="text-lg font-semibold text-foreground">{riskData.riskPerTrade}%</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Daily Loss Cap</p>
            <p className="text-lg font-semibold text-foreground">{formatPrice(riskData.dailyLossCap)}</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Max Consecutive Losses</p>
            <p className="text-lg font-semibold text-foreground">{riskData.maxConsecutiveLosses}</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg">
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
