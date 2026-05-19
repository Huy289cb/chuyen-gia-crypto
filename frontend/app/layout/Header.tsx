'use client';

import { RefreshCw, CheckCircle, AlertCircle, Clock, Sun, Moon, BookOpen } from 'lucide-react';
import { getTimeSince, cn } from '@/lib/utils';
import { useTheme } from '../components/ThemeProvider';
import { APP_VERSION } from '@/lib/version';
import { BrandLogo } from '../components/BrandLogo';

interface HeaderProps {
  onRefresh: () => void;
  isLoading: boolean;
  lastDashboardUpdate?: string;
}

export function Header({ onRefresh, isLoading, lastDashboardUpdate }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const dashboardFreshness = getTimeSince(lastDashboardUpdate);

  const getFreshnessIcon = (status: string) => {
    switch (status) {
      case 'fresh':
        return CheckCircle;
      case 'stale':
        return AlertCircle;
      case 'error':
        return AlertCircle;
      default:
        return Clock;
    }
  };

  const getFreshnessColor = (status: string) => {
    switch (status) {
      case 'fresh':
        return 'text-success';
      case 'stale':
        return 'text-warning';
      case 'error':
        return 'text-danger';
      case 'unknown':
        return 'text-foreground-tertiary';
      default:
        return 'text-foreground-tertiary';
    }
  };

  const DashboardIcon = getFreshnessIcon(dashboardFreshness.status);

  return (
    <header className="sticky top-0 z-50 glass border-b border-border-default">
      <div className="max-w-[90rem] mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2 sm:gap-3">
              <BrandLogo size="md" />
              <div>
                <h1 className="text-base sm:text-lg font-bold text-foreground">
                  <span className="hidden sm:inline">Download</span>
                  <span className="sm:hidden">D</span>
                  <span className="text-gradient">Money</span>
                  <span className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 text-xs font-medium bg-accent-primary/20 text-accent-primary rounded-full">
                    v{APP_VERSION}
                  </span>
                </h1>
                <p className="text-xs text-foreground-tertiary hidden sm:block">AI Trading Workspace</p>
              </div>
            </div>

            <a
              href="/rules"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 bg-surface-1 hover:bg-surface-2 border border-border-default hover:border-border-strong text-foreground-secondary hover:text-foreground"
              title="View System Rules & Behavior"
            >
              <BookOpen className="w-4 h-4" />
              <span className="text-sm font-medium">Rules</span>
            </a>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden md:flex items-center gap-1.5 text-xs">
              <DashboardIcon size={12} className={cn(getFreshnessColor(dashboardFreshness.status))} />
              <span className="text-foreground-tertiary">Dashboard:</span>
              <span className={cn('font-medium', getFreshnessColor(dashboardFreshness.status))}>
                {dashboardFreshness.text}
              </span>
            </div>

            <div
              className="flex md:hidden items-center gap-1"
              title={`Dashboard: ${dashboardFreshness.text}`}
            >
              <DashboardIcon size={14} className={cn(getFreshnessColor(dashboardFreshness.status))} />
            </div>

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
              title="Refresh dashboard"
            >
              <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
