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
  info: { icon: Info, color: 'text-info', bg: 'bg-info-dim' },
  success: { icon: CheckCircle, color: 'text-success', bg: 'bg-success-dim' },
  warning: { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning-dim' },
  error: { icon: XCircle, color: 'text-danger', bg: 'bg-danger-dim' },
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
    <div className={cn('px-4 py-3.5 rounded-lg border', config.bg, 'border-transparent')}>
      <div className="flex items-start gap-3">
        <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', config.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1.5">
            <span className="text-xs font-medium text-foreground-secondary truncate">{module}</span>
            <span className="text-xs text-foreground-tertiary flex items-center gap-1 shrink-0">
              <Clock className="w-3 h-3" />
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
