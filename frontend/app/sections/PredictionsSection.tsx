'use client';

import { useState, useEffect } from 'react';
import { Brain, ChevronDown, ChevronUp, Target, ArrowUp, ArrowDown, Minus, Clock } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { cn, formatPrice } from '@/lib/utils';
import type { PredictionHistory, ApiResponse } from '../types';

interface PredictionsSectionProps {
  symbol: string;
}

export function PredictionsSection({ symbol }: PredictionsSectionProps) {
  const [predictions, setPredictions] = useState<PredictionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchPredictions = async () => {
      try {
        const API_BASE = process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3000/api' 
          : '/api';
        const response = await fetch(`${API_BASE}/predictions/${symbol}?limit=20`);
        const data: ApiResponse<PredictionHistory[]> = await response.json();
        if (data.success && data.data) {
          setPredictions(data.data);
        }
      } catch (err) {
        console.error('Error fetching predictions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPredictions();
  }, [symbol]);

  if (loading) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Prediction Timeline" 
          subtitle="Loading..."
          icon={<Brain className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <div className="animate-pulse space-y-3 p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-surface-1 rounded-lg" />
            ))}
          </div>
        </Card>
      </section>
    );
  }

  if (predictions.length === 0) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Prediction Timeline" 
          subtitle="4H timeframe predictions"
          icon={<Brain className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <p className="text-foreground-tertiary text-sm text-center py-8">
            No prediction history available yet.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <CardHeader 
        title="Prediction Timeline"
        subtitle={`${symbol} 4H timeframe predictions & outcomes`}
        icon={<Brain className="w-5 h-5" />}
      />
      
      <Card className="mt-4" padding="none">
        <div className="divide-y divide-border-subtle">
          {predictions.map((prediction) => (
            <PredictionItem 
              key={prediction.id} 
              prediction={prediction}
              isExpanded={expandedId === prediction.id}
              onToggle={() => setExpandedId(expandedId === prediction.id ? null : prediction.id)}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

function PredictionItem({ 
  prediction, 
  isExpanded, 
  onToggle 
}: { 
  prediction: PredictionHistory; 
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const directionIcon = prediction.direction === 'up' ? ArrowUp : 
                       prediction.direction === 'down' ? ArrowDown : Minus;
  const directionColor = prediction.direction === 'up' ? 'text-success' : 
                        prediction.direction === 'down' ? 'text-danger' : 'text-foreground-tertiary';

  const outcomeConfig: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'neutral'; color: string }> = {
    'win': { label: 'WIN', variant: 'success', color: 'text-success' },
    'loss': { label: 'LOSS', variant: 'danger', color: 'text-danger' },
    'neutral': { label: 'NEUTRAL', variant: 'neutral', color: 'text-foreground-tertiary' },
    'pending': { label: 'PENDING', variant: 'warning', color: 'text-warning' },
    'null': { label: '-', variant: 'neutral', color: 'text-foreground-tertiary' },
  };
  const outcome = outcomeConfig[prediction.outcome || 'null'] || outcomeConfig['null'];

  const DirectionIcon = directionIcon;

  return (
    <div className="p-4 hover:bg-surface-1/30 transition-colors">
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {/* Direction */}
          <div className={cn('p-1.5 rounded-lg bg-surface-1', directionColor)}>
            <DirectionIcon size={16} />
          </div>
          
          {/* Info */}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-foreground">
                ${formatPrice(prediction.current_price)}
              </span>
              <Badge variant={outcome.variant} size="sm">
                {outcome.label}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-foreground-tertiary mt-0.5">
              <Clock size={12} />
              {prediction.timestamp ? new Date(prediction.timestamp).toLocaleString() : '-'}
            </div>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Confidence */}
          <div className="text-right">
            <div className="text-sm font-medium text-foreground">
              {prediction.confidence != null ? Math.round(prediction.confidence * 100) : 0}%
            </div>
            <div className="text-xs text-foreground-tertiary">Confidence</div>
          </div>
          
          {/* PnL if available */}
          {prediction.pnl != null && (
            <div className={cn(
              'text-right font-mono',
              prediction.pnl >= 0 ? 'text-success' : 'text-danger'
            )}>
              <div className="text-sm font-medium">
                {prediction.pnl >= 0 ? '+' : ''}${formatPrice(prediction.pnl)}
              </div>
              <div className="text-xs text-foreground-tertiary">PnL</div>
            </div>
          )}

          {/* Expand */}
          {isExpanded ? <ChevronUp size={16} className="text-foreground-tertiary" /> : 
                        <ChevronDown size={16} className="text-foreground-tertiary" />}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border-subtle grid grid-cols-2 sm:grid-cols-4 gap-3">
          {prediction.entry_price && (
            <div className="bg-surface-1 rounded-lg p-2">
              <span className="text-xs text-foreground-tertiary block">Entry</span>
              <span className="font-mono text-sm text-foreground">${formatPrice(prediction.entry_price)}</span>
            </div>
          )}
          {prediction.stop_loss && (
            <div className="bg-danger-dim rounded-lg p-2">
              <span className="text-xs text-danger block">Stop Loss</span>
              <span className="font-mono text-sm text-danger">${formatPrice(prediction.stop_loss)}</span>
            </div>
          )}
          {prediction.take_profit && (
            <div className="bg-success-dim rounded-lg p-2">
              <span className="text-xs text-success block">Take Profit</span>
              <span className="font-mono text-sm text-success">${formatPrice(prediction.take_profit)}</span>
            </div>
          )}
          <div className="bg-surface-1 rounded-lg p-2">
            <span className="text-xs text-foreground-tertiary block">Prediction ID</span>
            <span className="font-mono text-xs text-foreground truncate">{prediction.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}
