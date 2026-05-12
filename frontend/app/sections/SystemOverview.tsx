'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { MetricCard } from '../components/MetricCard';
import { Activity, Database, Shield, Bitcoin, Clock, Lock } from 'lucide-react';

interface SystemOverviewProps {
  className?: string;
}

export function SystemOverview({ className }: SystemOverviewProps) {
  // TODO: Replace with actual data from API
  const systemData = {
    workerStatus: 'healthy' as const,
    databaseStatus: 'healthy' as const,
    safetyValidation: 'passed' as const,
    btcOnlyScope: true,
    lockStatus: 'unlocked' as const,
  };

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
            status={systemData.workerStatus === 'healthy' ? 'healthy' : 'error'} 
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
            status={systemData.safetyValidation === 'passed' ? 'healthy' : 'error'} 
            label={systemData.safetyValidation === 'passed' ? 'Passed' : 'Failed'}
            size="sm"
          />
        </div>

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
