'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { ReasonChip } from '../components/ReasonChip';
import { Signal, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIntelligenceData } from '../hooks/useIntelligenceData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PanelErrorState } from '../components/PanelErrorState';
import { EmptyState } from '../components/EmptyState';

interface SignalGatePanelProps {
  className?: string;
}

export function SignalGatePanel({ className }: SignalGatePanelProps) {
  const { data, loading, error } = useIntelligenceData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Signal Gate"
          subtitle="Loading..."
          icon={<Signal className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Signal Gate"
          subtitle="Error loading data"
          icon={<Signal className="w-5 h-5" />}
        />
        <PanelErrorState message={error} />
      </Card>
    );
  }

  if (!data?.signalGate) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Signal Gate"
          subtitle="No evaluations recorded yet"
          icon={<Signal className="w-5 h-5" />}
        />
        <EmptyState
          icon={Signal}
          title="No evaluations yet"
          description="Run the worker pipeline to populate trade decisions."
          size="sm"
        />
      </Card>
    );
  }

  const signalData = data.signalGate;
  const confidencePct =
    signalData.confidence > 0 && signalData.confidence <= 1
      ? signalData.confidence * 100
      : signalData.confidence;

  return (
    <Card className={className}>
      <SectionHeader
        title="Signal Gate"
        subtitle={
          signalData.timeframe
            ? `Entry ưu tiên 15m → 1h → 5m · đang xem ${signalData.timeframe}`
            : 'Entry ưu tiên 15m → 1h → 5m'
        }
        icon={<Signal className="w-5 h-5" />}
      />

      <div className="space-y-4">
        <div className="panel-row flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
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
            className="shrink-0"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Grade</p>
            <p className="text-lg font-semibold text-accent-primary">{signalData.grade}</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Confidence</p>
            <p className="text-lg font-semibold text-foreground">{confidencePct.toFixed(0)}%</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Playbook</p>
            <p className="text-sm font-medium text-foreground">{signalData.playbook}</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Regime</p>
            <p className="text-sm font-medium text-foreground">{signalData.regime}</p>
          </div>
          {signalData.timeframe ? (
            <div className="panel-stat col-span-2">
              <p className="text-xs text-foreground-tertiary mb-1">Source timeframe</p>
              <p className="text-sm font-medium text-foreground">{signalData.timeframe}</p>
            </div>
          ) : null}
        </div>

        {(signalData.detailReason || signalData.setupReason) && !signalData.pass ? (
          <details className="panel-details group border-warning/20 bg-warning-dim/30">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-foreground-secondary [&::-webkit-details-marker]:hidden">
              <span className="text-foreground-tertiary">
                Bằng chứng lần quét ({signalData.timeframe || 'best'})
              </span>
              <span className="ml-2 text-accent-primary group-open:hidden">— mở rộng</span>
              <span className="ml-2 text-accent-primary hidden group-open:inline">— thu gọn</span>
            </summary>
            <pre className="max-h-36 overflow-y-auto px-3 pb-3 text-xs text-foreground leading-relaxed whitespace-pre-wrap font-sans">
              {signalData.detailReason || signalData.setupReason}
            </pre>
          </details>
        ) : null}

        {signalData.evaluations && signalData.evaluations.length > 0 ? (
          <details className="panel-details group">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-foreground-tertiary [&::-webkit-details-marker]:hidden">
              Theo khung thời gian ({signalData.evaluations.length})
              <span className="ml-2 normal-case text-accent-primary group-open:hidden">— mở rộng</span>
            </summary>
            <div className="max-h-52 overflow-y-auto space-y-2 px-3 pb-3">
              {signalData.evaluations.map((row) => (
                <div
                  key={row.timeframe}
                  className="panel-stat text-sm"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium text-foreground">{row.timeframe}</span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        row.pass ? 'text-success' : 'text-danger'
                      )}
                    >
                      {row.pass ? 'PASS' : 'BLOCK'} · grade {row.grade}
                    </span>
                  </div>
                  <p className="text-xs text-foreground-tertiary">
                    {row.regime}
                    {'gateRegime' in row &&
                    row.gateRegime &&
                    row.gateRegime !== row.regime
                      ? ` → gate ${String(row.gateRegime)}`
                      : ''}
                    {row.playbook !== 'none' ? ` · ${row.playbook}` : ''}
                  </p>
                  {!row.pass && (row.detailReason || row.setupReason) ? (
                    <pre className="text-xs text-foreground mt-1.5 max-h-24 overflow-y-auto leading-relaxed whitespace-pre-wrap font-sans">
                      {row.detailReason || row.setupReason}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <div>
          <p className="text-xs text-foreground-tertiary mb-2 uppercase tracking-wide">Tóm tắt</p>
          <div className="flex flex-wrap gap-2">
            {signalData.reasonCodes && signalData.reasonCodes.length > 0 ? (
              signalData.reasonCodes.map((code) => (
                <ReasonChip key={code} label={code} variant="info" />
              ))
            ) : (
              <span className="text-xs text-foreground-tertiary">No reason codes available</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
