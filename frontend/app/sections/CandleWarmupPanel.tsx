'use client';

import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { BarChart3 } from 'lucide-react';

interface CandleWarmupPanelProps {
  className?: string;
}

export function CandleWarmupPanel({ className }: CandleWarmupPanelProps) {
  // TODO: Replace with actual data from API
  const warmupData = {
    totalCandles: 1250,
    requiredCandles: 2000,
    isWarmedUp: false,
    timeframes: [
      { name: '15m', loaded: 500, required: 1000 },
      { name: '1h', loaded: 400, required: 500 },
      { name: '4h', loaded: 250, required: 300 },
      { name: '1d', loaded: 100, required: 200 },
    ],
  };

  const overallProgress = (warmupData.totalCandles / warmupData.requiredCandles) * 100;

  return (
    <Card className={className}>
      <SectionHeader
        title="Candle Warmup"
        subtitle="Data collection progress"
        icon={<BarChart3 className="w-5 h-5" />}
      />
      
      <div className="space-y-4">
        {/* Overall Status */}
        <div className="flex items-center justify-between p-3 bg-surface-1/50 rounded-lg">
          <div>
            <span className="text-sm text-foreground-secondary">Overall Status</span>
            <div className="text-xs text-foreground-tertiary mt-1">
              {warmupData.totalCandles} / {warmupData.requiredCandles} candles
            </div>
          </div>
          <StatusBadge 
            status={warmupData.isWarmedUp ? 'healthy' : 'warming_up'} 
            size="sm"
          />
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-foreground-tertiary">
            <span>Progress</span>
            <span>{overallProgress.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div 
              className="h-full bg-accent-primary transition-all duration-500"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>

        {/* Timeframe Breakdown */}
        <div className="space-y-2">
          <span className="text-xs text-foreground-tertiary uppercase tracking-wide">By Timeframe</span>
          {warmupData.timeframes.map((tf) => {
            const progress = (tf.loaded / tf.required) * 100;
            return (
              <div key={tf.name} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-foreground-secondary">{tf.name}</span>
                  <span className="text-foreground-tertiary">{tf.loaded}/{tf.required}</span>
                </div>
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${
                      progress >= 100 ? 'bg-success' : 'bg-accent-primary'
                    }`}
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
