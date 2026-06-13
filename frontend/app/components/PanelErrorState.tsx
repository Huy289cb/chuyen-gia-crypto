import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PanelErrorStateProps {
  message: string;
  className?: string;
}

export function PanelErrorState({ message, className }: PanelErrorStateProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-xl bg-danger-dim border border-danger/20',
        className
      )}
      role="alert"
    >
      <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden />
      <p className="text-sm text-danger leading-relaxed">{message}</p>
    </div>
  );
}
