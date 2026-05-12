'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Bot, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { formatVietnamTime } from '@/lib/utils';

interface LlmDispatchPanelProps {
  className?: string;
}

export function LlmDispatchPanel({ className }: LlmDispatchPanelProps) {
  // TODO: Replace with actual data from API
  const llmData = {
    lastCall: new Date(Date.now() - 300000).toISOString(),
    modelName: 'llama-3.3-70b-versatile',
    promptVersion: 'v2.1',
    responseStatus: 'success' as const,
    invalidJsonCount: 0,
    noTradeCount: 2,
    skippedCallCount: 1,
  };

  return (
    <Card className={className}>
      <SectionHeader
        title="LLM Dispatch"
        subtitle="Groq AI usage stats"
        icon={<Bot className="w-5 h-5" />}
      />
      
      <div className="space-y-4">
        {/* Last Call Info */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent-primary" />
            <span className="text-sm text-foreground-secondary">Last Call</span>
          </div>
          <span className="text-xs text-foreground-tertiary">{formatVietnamTime(llmData.lastCall)}</span>
        </div>

        {/* Model Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Model</p>
            <p className="text-sm font-medium text-foreground truncate">{llmData.modelName}</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg">
            <p className="text-xs text-foreground-tertiary mb-1">Prompt Version</p>
            <p className="text-sm font-medium text-foreground">{llmData.promptVersion}</p>
          </div>
        </div>

        {/* Response Status */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <span className="text-sm text-foreground-secondary">Response Status</span>
          <StatusBadge 
            status={llmData.responseStatus === 'success' ? 'healthy' : 'error'}
            label={llmData.responseStatus}
            size="sm"
          />
        </div>

        {/* Error Counts */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-surface-1/50 rounded-lg text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <AlertTriangle className="w-3 h-3 text-danger" />
              <span className="text-xs text-foreground-tertiary">Invalid JSON</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{llmData.invalidJsonCount}</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <CheckCircle className="w-3 h-3 text-warning" />
              <span className="text-xs text-foreground-tertiary">No-Trade</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{llmData.noTradeCount}</p>
          </div>
          <div className="p-3 bg-surface-1/50 rounded-lg text-center">
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
