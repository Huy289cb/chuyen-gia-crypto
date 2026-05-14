'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { Brain, AlertCircle } from 'lucide-react';
import { cn, formatVietnamTime } from '@/lib/utils';
import { useIntelligenceData } from '../hooks/useIntelligenceData';
import { LoadingSkeleton } from '../components/LoadingSkeleton';

interface MemoryInsightsPanelProps {
  className?: string;
}

export function MemoryInsightsPanel({ className }: MemoryInsightsPanelProps) {
  const { data, loading, error } = useIntelligenceData();

  if (loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Memory Insights"
          subtitle="Loading..."
          icon={<Brain className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (error || !data?.memory) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Memory Insights"
          subtitle="Error loading data"
          icon={<Brain className="w-5 h-5" />}
        />
        <div className="p-4 text-sm text-red-500">{error || 'Failed to load memory data'}</div>
      </Card>
    );
  }

  const memoryData = data.memory;

  return (
    <Card className={className}>
      <SectionHeader
        title="Memory Insights"
        subtitle="AI learning from history"
        icon={<Brain className="w-5 h-5" />}
      />

      <div className="space-y-4">
        {/* Similar Setups */}
        <div>
          <p className="text-xs text-foreground-tertiary mb-2 uppercase tracking-wide">Last 3 Similar Setups</p>
          <div className="space-y-2">
            {memoryData.similarSetups && memoryData.similarSetups.length > 0 ? (
              memoryData.similarSetups.map((setup) => (
                <div
                  key={setup.id}
                  className="p-3 bg-surface-1/50 rounded-lg space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{setup.playbook}</span>
                    <span className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded',
                      setup.result === 'WIN' ? 'bg-success/15 text-success' :
                      setup.result === 'LOSS' ? 'bg-danger/15 text-danger' :
                      'bg-surface-2 text-foreground-tertiary'
                    )}>
                      {setup.result}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground-tertiary">{formatVietnamTime(setup.date)}</span>
                    <span className={cn(
                      'font-mono',
                      setup.pnl >= 0 ? 'text-success' : 'text-danger'
                    )}>
                      {setup.pnl >= 0 ? '+' : ''}{setup.pnl}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-3 text-xs text-foreground-tertiary text-center">No similar setups found</div>
            )}
          </div>
        </div>

        {/* Playbook Winrate */}
        <div>
          <p className="text-xs text-foreground-tertiary mb-2 uppercase tracking-wide">Playbook Winrate</p>
          <div className="space-y-2">
            {Object.keys(memoryData.playbookWinrate).length > 0 ? (
              Object.entries(memoryData.playbookWinrate).map(([playbook, winrate]) => (
                <div key={playbook} className="flex items-center justify-between">
                  <span className="text-sm text-foreground-secondary">{playbook}</span>
                  <span className={cn(
                    'text-sm font-mono font-semibold',
                    winrate >= 70 ? 'text-success' : winrate >= 50 ? 'text-warning' : 'text-danger'
                  )}>
                    {winrate.toFixed(1)}%
                  </span>
                </div>
              ))
            ) : (
              <div className="p-3 text-xs text-foreground-tertiary text-center">No playbook data available</div>
            )}
          </div>
        </div>

        {/* Failure Patterns */}
        <div>
          <p className="text-xs text-foreground-tertiary mb-2 uppercase tracking-wide">Recurring Failure Patterns</p>
          <div className="space-y-2">
            {memoryData.failurePatterns && memoryData.failurePatterns.length > 0 ? (
              memoryData.failurePatterns.map((pattern, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2 bg-danger-dim rounded-lg"
                >
                  <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                  <span className="text-xs text-foreground">{pattern}</span>
                </div>
              ))
            ) : (
              <div className="p-3 text-xs text-foreground-tertiary text-center">No failure patterns recorded</div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
