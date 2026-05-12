'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { ReasonChip } from '../components/ReasonChip';
import { Signal, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SignalGatePanelProps {
  className?: string;
}

export function SignalGatePanel({ className }: SignalGatePanelProps) {
  // TODO: Replace with actual data from API
  const signalData = {
    grade: 'A',
    confidence: 85,
    playbook: 'Liquidity Sweep',
    regime: 'Bullish',
    pass: true,
    reasonCodes: ['valid_setup', 'high_confidence', 'regime_aligned'],
  };

  return (
    <Card className={className}>
      <SectionHeader
        title="Signal Gate"
        subtitle="Latest signal evaluation"
        icon={<Signal className="w-5 h-5" />}
      />
      
      <div className="space-y-4">
        {/* Pass/Block Status */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div className="flex items-center gap-2">
            {signalData.pass ? (
              <CheckCircle className="w-5 h-5 text-success" />
            ) : (
              <XCircle className="w-5 h-5 text-danger" />
            )}
            <span className="text-sm font-medium text-foreground">
              {signalData.pass ? 'Signal Passed' : 'Signal Blocked'}
            </span>
          </div>
          <StatusBadge 
            status={signalData.pass ? 'trading_enabled' : 'blocked'}
            size="sm"
          />
        </div>

        {/* Signal Details */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Grade</p>
            <p className="text-lg font-semibold text-accent-primary">{signalData.grade}</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Confidence</p>
            <p className="text-lg font-semibold text-foreground">{signalData.confidence}%</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Playbook</p>
            <p className="text-sm font-medium text-foreground">{signalData.playbook}</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Regime</p>
            <p className="text-sm font-medium text-foreground">{signalData.regime}</p>
          </div>
        </div>

        {/* Reason Codes */}
        <div>
          <p className="text-xs text-foreground-tertiary mb-2 uppercase tracking-wide">Reason Codes</p>
          <div className="flex flex-wrap gap-2">
            {signalData.reasonCodes.map((code) => (
              <ReasonChip key={code} label={code} variant="info" />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
