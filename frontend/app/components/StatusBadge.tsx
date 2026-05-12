import { cn } from '@/lib/utils';
import { Badge } from './ui/Badge';

type StatusType = 
  | 'healthy' 
  | 'warming_up' 
  | 'blocked' 
  | 'trading_enabled' 
  | 'trading_paused' 
  | 'btc_only' 
  | 'error' 
  | 'loading'
  | 'unknown';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<StatusType, { variant: 'success' | 'danger' | 'warning' | 'info' | 'neutral', defaultLabel: string }> = {
  healthy: { variant: 'success', defaultLabel: 'Healthy' },
  warming_up: { variant: 'warning', defaultLabel: 'Warming Up' },
  blocked: { variant: 'danger', defaultLabel: 'Blocked' },
  trading_enabled: { variant: 'success', defaultLabel: 'Trading Enabled' },
  trading_paused: { variant: 'warning', defaultLabel: 'Trading Paused' },
  btc_only: { variant: 'info', defaultLabel: 'BTC Only' },
  error: { variant: 'danger', defaultLabel: 'Error' },
  loading: { variant: 'neutral', defaultLabel: 'Loading' },
  unknown: { variant: 'neutral', defaultLabel: 'Unknown' },
};

export function StatusBadge({ status, label, className, size = 'sm' }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.unknown;
  const displayLabel = label || config.defaultLabel;

  return (
    <Badge 
      variant={config.variant} 
      size={size}
      className={className}
    >
      {displayLabel}
    </Badge>
  );
}
