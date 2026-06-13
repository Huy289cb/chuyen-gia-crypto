'use client';

import { cn } from '@/lib/utils';
import { CheckCircle, XCircle, AlertCircle, Info, Clock } from 'lucide-react';

type EventSeverity = 'info' | 'success' | 'warning' | 'error';

interface EventLogItemProps {
  timestamp: string;
  module: string;
  message: string;
  severity?: EventSeverity;
  details?: string;
}

const severityConfig = {
  info: { icon: Info, color: 'text-info', bg: 'bg-info-dim', border: 'border-info/15' },
  success: { icon: CheckCircle, color: 'text-success', bg: 'bg-success-dim', border: 'border-success/15' },
  warning: { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning-dim', border: 'border-warning/15' },
  error: { icon: XCircle, color: 'text-danger', bg: 'bg-danger-dim', border: 'border-danger/15' },
};

export function EventLogItem({
  timestamp,
  module,
  message,
  severity = 'info',
  details,
}: EventLogItemProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'px-3.5 py-3 rounded-lg border transition-colors duration-200',
        config.bg,
        config.border
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', config.color)} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1.5">
            <span className="text-xs font-medium text-foreground-secondary truncate">{module}</span>
            <span className="text-xs text-foreground-tertiary flex items-center gap-1 shrink-0 tabular-nums">
              <Clock className="w-3 h-3" aria-hidden />
              {timestamp}
            </span>
          </div>
          <p className="text-sm text-foreground break-words leading-relaxed">{message}</p>
          {details && (
            <p className="text-xs text-foreground-tertiary mt-1.5 break-words leading-relaxed whitespace-pre-line">
              {details}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
