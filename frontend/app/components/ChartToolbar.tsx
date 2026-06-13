'use client';

import { cn } from '@/lib/utils';
import { RefreshCw, Maximize2, Settings } from 'lucide-react';
import { Button } from './ui/Button';

interface ChartToolbarProps {
  onRefresh?: () => void;
  onFullscreen?: () => void;
  onSettings?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

export function ChartToolbar({
  onRefresh,
  onFullscreen,
  onSettings,
  isRefreshing = false,
  className,
}: ChartToolbarProps) {
  if (!onRefresh && !onFullscreen && !onSettings) return null;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-border-default/60 bg-surface-1/50',
        className
      )}
      role="toolbar"
      aria-label="Chart controls"
    >
      {onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-7 w-7 p-0 text-foreground-secondary hover:text-foreground"
          title="Refresh chart"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
        </Button>
      )}
      {onFullscreen && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onFullscreen}
          className="h-7 w-7 p-0 text-foreground-secondary hover:text-foreground"
          title="Fullscreen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
      )}
      {onSettings && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onSettings}
          className="h-7 w-7 p-0 text-foreground-secondary hover:text-foreground"
          title="Chart settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
