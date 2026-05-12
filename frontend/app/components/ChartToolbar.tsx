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
  className 
}: ChartToolbarProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="text-foreground-secondary hover:text-foreground"
        >
          <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
        </Button>
      )}
      {onFullscreen && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onFullscreen}
          className="text-foreground-secondary hover:text-foreground"
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
      )}
      {onSettings && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onSettings}
          className="text-foreground-secondary hover:text-foreground"
        >
          <Settings className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
