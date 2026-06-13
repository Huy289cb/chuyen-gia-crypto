'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  const pathname = usePathname();
  const dashboardFreshness = getTimeSince(lastDashboardUpdate);
  const isRulesActive = pathname === '/rules';

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

  const iconButtonClass = cn(
    'p-2 rounded-lg transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
    'bg-surface-1 hover:bg-surface-2 active:scale-[0.96]',
    'border border-border-default hover:border-border-strong',
    'text-foreground-secondary hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50'
  );

  return (
    <header className="sticky top-0 z-50 glass border-b border-border-default">
      <div className="max-w-[90rem] mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          <div className="flex items-center gap-3 sm:gap-6">
            <div className="flex items-center gap-2 sm:gap-3">
              <BrandLogo size="md" />
              <div>
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
                  <span className="hidden sm:inline">Download</span>
                  <span className="sm:hidden">D</span>
                  <span className="text-gradient">Money</span>
                  <span className="ml-1 sm:ml-2 px-1.5 sm:px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-accent-primary/15 text-accent-primary rounded-md">
                    v{APP_VERSION}
                  </span>
                </h1>
                <p className="text-xs text-foreground-tertiary hidden sm:block">AI Trading Workspace</p>
              </div>
            </div>

            <Link
              href="/rules"
              aria-current={isRulesActive ? 'page' : undefined}
              className={cn(
                'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200',
                'border active:scale-[0.98]',
                isRulesActive
                  ? 'bg-accent-primary/15 border-accent-primary/30 text-accent-primary font-medium'
                  : 'bg-surface-1 hover:bg-surface-2 border-border-default hover:border-border-strong text-foreground-secondary hover:text-foreground'
              )}
              title="View System Rules & Behavior"
            >
              <BookOpen className="w-4 h-4" />
              <span className="text-sm font-medium">Rules</span>
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-surface-1/80 border border-border-default/60">
              <DashboardIcon size={12} className={cn(getFreshnessColor(dashboardFreshness.status))} />
              <span className="text-foreground-tertiary">Dashboard:</span>
              <span className={cn('font-medium tabular-nums', getFreshnessColor(dashboardFreshness.status))}>
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
              className={iconButtonClass}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            <button
              onClick={onRefresh}
              disabled={isLoading}
              className={cn(iconButtonClass, isLoading && 'opacity-50 cursor-not-allowed active:scale-100')}
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
