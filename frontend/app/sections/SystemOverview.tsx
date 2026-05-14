'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Activity, Database, Shield, Bitcoin, Lock } from 'lucide-react';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface SystemOverviewProps {
  className?: string;
}

export function SystemOverview({ className }: SystemOverviewProps) {
  const { data, loading, error } = useDashboardSummary();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="System Overview"
          subtitle="Loading..."
          icon={<Activity className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error || !data?.systemHealth) {
    return (
      <Card className={className}>
        <SectionHeader
          title="System Overview"
          subtitle="Error loading data"
          icon={<Activity className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-red-500">{error || 'Failed to load system data'}</div>
      </Card>
    );
  }

  const systemData = data.systemHealth;
  const safetyOk = systemData.safetyValidation === 'passed';

  return (
    <Card className={className}>
      <SectionHeader
        title="System Overview"
        subtitle="Health and status"
        icon={<Activity className="w-5 h-5" />}
      />

      <div className="space-y-4">
        {/* Worker Status */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Activity className="w-4 h-4 text-accent-primary" />
            <span className="text-sm text-foreground-secondary">Worker Status</span>
          </div>
          <StatusBadge
            status={
              systemData.workerStatus === 'healthy'
                ? 'healthy'
                : systemData.workerStatus === 'stale'
                  ? 'trading_paused'
                  : 'unknown'
            }
            label={
              systemData.workerStatus === 'healthy'
                ? 'Healthy'
                : systemData.workerStatus === 'stale'
                  ? 'Stale'
                  : 'Idle'
            }
            size="sm"
          />
        </div>

        {/* Database Status */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Database className="w-4 h-4 text-accent-primary" />
            <span className="text-sm text-foreground-secondary">Database Status</span>
          </div>
          <StatusBadge
            status={systemData.databaseStatus === 'healthy' ? 'healthy' : 'error'}
            size="sm"
          />
        </div>

        {/* Safety Validation */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Shield className="w-4 h-4 text-accent-primary" />
            <span className="text-sm text-foreground-secondary">Safety Validation</span>
          </div>
          <StatusBadge
            status={safetyOk ? 'healthy' : 'error'}
            label={safetyOk ? 'Passed' : 'Failed'}
            size="sm"
          />
        </div>
        {!safetyOk && (
          <p className="text-xs text-danger px-1">{systemData.safetyValidation}</p>
        )}

        {/* BTC-only Scope */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Bitcoin className="w-4 h-4 text-accent-primary" />
            <span className="text-sm text-foreground-secondary">BTC-only Scope</span>
          </div>
          <StatusBadge
            status={systemData.btcOnlyScope ? 'btc_only' : 'trading_paused'}
            label={systemData.btcOnlyScope ? 'Active' : 'Disabled'}
            size="sm"
          />
        </div>

        {/* Lock Status */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Lock className="w-4 h-4 text-accent-primary" />
            <span className="text-sm text-foreground-secondary">Lock Status</span>
          </div>
          <StatusBadge
            status={systemData.lockStatus === 'unlocked' ? 'trading_enabled' : 'blocked'}
            label={systemData.lockStatus === 'unlocked' ? 'Unlocked' : 'Locked'}
            size="sm"
          />
        </div>
      </div>
    </Card>
  );
}
