'use client';

import { useState, useEffect } from 'react';
import { Zap, RefreshCw, CheckCircle, AlertCircle, Clock, Sun, Moon, BookOpen, Play } from 'lucide-react';
import { getTimeSince, cn } from '@/lib/utils';
import { useTheme } from '../components/ThemeProvider';
import { useSearchParams } from 'next/navigation';
import { APP_VERSION } from '@/lib/version';

interface HeaderProps {
  onRefresh: () => void;
  onTriggerAnalysis?: () => void;
  isTriggering?: boolean;
  isLoading: boolean;
  lastPriceUpdate?: string;
  lastAnalysisUpdate?: string;
}

export function Header({ onRefresh, onTriggerAnalysis, isTriggering, isLoading, lastPriceUpdate, lastAnalysisUpdate }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const priceFreshness = getTimeSince(lastPriceUpdate);
  const analysisFreshness = getTimeSince(lastAnalysisUpdate);

  const getFreshnessIcon = (status: string) => {
    switch (status) {
      case 'fresh': return CheckCircle;
      case 'stale': return AlertCircle;
      case 'error': return AlertCircle;
      default: return Clock;
    }
  };

  const getFreshnessColor = (status: string) => {
    switch (status) {
      case 'fresh': return 'text-success';
      case 'stale': return 'text-warning';
      case 'error': return 'text-danger';
      case 'unknown': return 'text-foreground-tertiary';
      default: return 'text-foreground-tertiary';
    }
  };

  const PriceIcon = getFreshnessIcon(priceFreshness.status);
  const AnalysisIcon = getFreshnessIcon(analysisFreshness.status);

  return (
    <header className="sticky top-0 z-50 glass border-b border-border-default">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo + Navigation */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="relative p-2 bg-gradient-to-br from-accent-primary to-accent-secondary rounded-xl animate-pulse-glow">
                <Zap className="w-5 h-5 text-bg-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">
                  Crypto<span className="text-gradient">Analyzer</span>
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-accent-primary/20 text-accent-primary rounded-full">v{APP_VERSION}</span>
                </h1>
                <p className="text-xs text-foreground-tertiary hidden sm:block">
                  AI-Powered Trading Analysis
                </p>
              </div>
            </div>
            
            {/* Rules Link */}
            <a
              href="/rules"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 bg-surface-1 hover:bg-surface-2 border border-border-default hover:border-border-strong text-foreground-secondary hover:text-foreground"
              title="View System Rules & Behavior"
            >
              <BookOpen className="w-4 h-4" />
              <span className="text-sm font-medium">Rules</span>
            </a>
          </div>

          {/* Data Freshness + Refresh */}
          <div className="flex items-center gap-4">
            {/* Freshness Indicators */}
            <div className="hidden sm:flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <PriceIcon size={12} className={cn(getFreshnessColor(priceFreshness.status))} />
                <span className="text-foreground-tertiary">Price:</span>
                <span className={cn('font-medium', getFreshnessColor(priceFreshness.status))}>
                  {priceFreshness.text}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <AnalysisIcon size={12} className={cn(getFreshnessColor(analysisFreshness.status))} />
                <span className="text-foreground-tertiary">Analysis:</span>
                <span className={cn('font-medium', getFreshnessColor(analysisFreshness.status))}>
                  {analysisFreshness.text}
                </span>
              </div>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={cn(
                'p-2 rounded-lg transition-all duration-200',
                'bg-surface-1 hover:bg-surface-2',
                'border border-border-default hover:border-border-strong',
                'text-foreground-secondary hover:text-foreground'
              )}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {/* Trigger Analysis Button */}
            {onTriggerAnalysis && (
              <button
                onClick={onTriggerAnalysis}
                disabled={isTriggering || isLoading}
                className={cn(
                  'p-2 rounded-lg transition-all duration-200',
                  'bg-accent-primary hover:bg-accent-secondary',
                  'border border-accent-primary hover:border-accent-secondary',
                  'text-bg-primary',
                  (isTriggering || isLoading) && 'opacity-50 cursor-not-allowed'
                )}
                title="Trigger AI analysis"
              >
                <Play className={cn('w-4 h-4', isTriggering && 'animate-pulse')} />
              </button>
            )}

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className={cn(
                'p-2 rounded-lg transition-all duration-200',
                'bg-surface-1 hover:bg-surface-2',
                'border border-border-default hover:border-border-strong',
                'text-foreground-secondary hover:text-foreground',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
              title="Refresh data"
            >
              <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
