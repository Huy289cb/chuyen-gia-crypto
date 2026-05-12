'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { Brain, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { formatPercentage } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface MemoryInsightsPanelProps {
  className?: string;
}

export function MemoryInsightsPanel({ className }: MemoryInsightsPanelProps) {
  // TODO: Replace with actual data from API
  const memoryData = {
    similarSetups: [
      { id: 1, playbook: 'Liquidity Sweep', result: 'WIN', pnl: 450, date: '2 days ago' },
      { id: 2, playbook: 'Liquidity Sweep', result: 'WIN', pnl: 320, date: '5 days ago' },
      { id: 3, playbook: 'Liquidity Sweep', result: 'LOSS', pnl: -150, date: '1 week ago' },
    ],
    playbookWinrate: {
      'Liquidity Sweep': 75,
      'Breakout': 60,
      'Trend Continuation': 68,
    },
    failurePatterns: [
      'Entering during high volatility',
      'Ignoring regime mismatch',
      'Late entry after confirmation',
    ],
  };

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
            {memoryData.similarSetups.map((setup) => (
              <div 
                key={setup.id}
                className="p-3 bg-surface-1/50 rounded-lg space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{setup.playbook}</span>
                  <span className={cn(
                    'text-xs font-semibold px-2 py-0.5 rounded',
                    setup.result === 'WIN' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
                  )}>
                    {setup.result}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground-tertiary">{setup.date}</span>
                  <span className={cn(
                    'font-mono',
                    setup.pnl >= 0 ? 'text-success' : 'text-danger'
                  )}>
                    {setup.pnl >= 0 ? '+' : ''}{setup.pnl}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Playbook Winrate */}
        <div>
          <p className="text-xs text-foreground-tertiary mb-2 uppercase tracking-wide">Playbook Winrate</p>
          <div className="space-y-2">
            {Object.entries(memoryData.playbookWinrate).map(([playbook, winrate]) => (
              <div key={playbook} className="flex items-center justify-between">
                <span className="text-sm text-foreground-secondary">{playbook}</span>
                <span className={cn(
                  'text-sm font-mono font-semibold',
                  winrate >= 70 ? 'text-success' : winrate >= 50 ? 'text-warning' : 'text-danger'
                )}>
                  {formatPercentage(winrate)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Failure Patterns */}
        <div>
          <p className="text-xs text-foreground-tertiary mb-2 uppercase tracking-wide">Recurring Failure Patterns</p>
          <div className="space-y-2">
            {memoryData.failurePatterns.map((pattern, idx) => (
              <div 
                key={idx}
                className="flex items-center gap-2 p-2 bg-danger-dim rounded-lg"
              >
                <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
                <span className="text-xs text-foreground">{pattern}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
