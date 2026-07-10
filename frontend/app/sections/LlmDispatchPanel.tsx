'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Bot, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { formatVietnamTime } from '@/lib/utils';
import { useIntelligenceData } from '../hooks/useIntelligenceData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PanelErrorState } from '../components/PanelErrorState';

interface LlmDispatchPanelProps {
  className?: string;
}

export function LlmDispatchPanel({ className }: LlmDispatchPanelProps) {
  const { data, loading, error } = useIntelligenceData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="LLM Dispatch"
          subtitle="Loading..."
          icon={<Bot className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="LLM Dispatch"
          subtitle="Error loading data"
          icon={<Bot className="w-5 h-5" />}
        />
        <PanelErrorState message={error} />
      </Card>
    );
  }

  if (!data?.llm) {
    return (
      <Card className={className}>
        <SectionHeader
          title="LLM Dispatch"
          subtitle="No LLM activity recorded yet"
          icon={<Bot className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-foreground-secondary">Waiting for first LLM dispatch.</div>
      </Card>
    );
  }

  const llmData = data.llm;

  return (
    <Card className={className}>
      <SectionHeader
        title="LLM Dispatch"
        subtitle="Groq AI usage stats"
        icon={<Bot className="w-5 h-5" />}
      />

      <div className="space-y-4">
        <div className="panel-row flex items-center justify-between">
          <span className="text-sm text-foreground-secondary">Calls today (LLM path)</span>
          <span className="text-sm font-mono text-foreground">{llmData.callsToday ?? 0}</span>
        </div>

        {llmData.lastEngagedSummary ? (
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Lần gọi gần nhất</p>
            <p className="text-sm text-foreground line-clamp-4">{llmData.lastEngagedSummary}</p>
          </div>
        ) : null}

        <div className="panel-row flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent-primary" />
            <span className="text-sm text-foreground-secondary">Last Call</span>
          </div>
          <span className="text-xs text-foreground-tertiary">
            {llmData.lastCall ? formatVietnamTime(llmData.lastCall) : 'Never'}
          </span>
        </div>

        {/* Model Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Model</p>
            <p className="text-sm font-medium text-foreground truncate">{llmData.modelName}</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Prompt Version</p>
            <p className="text-sm font-medium text-foreground">{llmData.promptVersion}</p>
          </div>
        </div>

        {/* Response Status */}
        <div className="panel-row flex items-center justify-between">
          <span className="text-sm text-foreground-secondary">Response Status</span>
          <StatusBadge
            status={
              llmData.responseStatus === 'success'
                ? 'healthy'
                : llmData.responseStatus === 'degraded'
                  ? 'trading_paused'
                  : llmData.responseStatus === 'none'
                    ? 'unknown'
                    : 'error'
            }
            label={llmData.responseStatus}
            size="sm"
          />
        </div>

        {/* Error Counts */}
        <div className="grid grid-cols-3 gap-3">
          <div className="panel-stat text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <AlertTriangle className="w-3 h-3 text-danger" />
              <span className="text-xs text-foreground-tertiary">Invalid JSON</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{llmData.invalidJsonCount}</p>
          </div>
          <div className="panel-stat text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <CheckCircle className="w-3 h-3 text-warning" />
              <span className="text-xs text-foreground-tertiary">No-Trade</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{llmData.noTradeCount}</p>
          </div>
          <div className="panel-stat text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Clock className="w-3 h-3 text-info" />
              <span className="text-xs text-foreground-tertiary">Skipped</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{llmData.skippedCallCount}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
