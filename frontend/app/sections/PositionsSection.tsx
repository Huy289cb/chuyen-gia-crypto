'use client';

import { useState } from 'react';
import { XCircle, Target, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Brain, Info } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { cn, formatPrice, formatVietnamTime } from '@/lib/utils';
import type { Position } from '../types';

interface PositionsSectionProps {
  positions: Position[];
  onClosePosition: (positionId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
}

interface Prediction {
  id: number;
  timeframe: string;
  direction: string;
  target_price: number;
  confidence: number;
  predicted_at: string;
  reason_summary: string;
  suggested_entry: number;
  suggested_stop_loss: number;
  suggested_take_profit: number;
  expected_rr: number;
}

export function PositionsSection({ positions, onClosePosition }: PositionsSectionProps) {
  // Filter out ETH positions - only show BTC positions
  const btcPositions = positions.filter(position => position.symbol === 'BTC');
  
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [predictionPage, setPredictionPage] = useState(1);
  const [totalPredictions, setTotalPredictions] = useState(0);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  
  const fetchPredictions = async (positionId: string, page: number = 1) => {
    setLoadingPredictions(true);
    try {
      const response = await fetch(`/api/positions/${positionId}/predictions?limit=5&page=${page}`);
      const data = await response.json();
      if (data.success) {
        setPredictions(data.data);
        setTotalPredictions(data.meta.total);
        setPredictionPage(page);
      }
    } catch (error) {
      console.error('Failed to fetch predictions:', error);
    } finally {
      setLoadingPredictions(false);
    }
  };

  const handlePositionClick = (position: Position) => {
    setSelectedPosition(position);
    setPredictionPage(1);
    fetchPredictions(position.id, 1);
  };
  
  const closePredictionsModal = () => {
    setSelectedPosition(null);
    setPredictions([]);
    setPredictionPage(1);
    setTotalPredictions(0);
  };
  
  if (btcPositions.length === 0) {
    return (
      <section className="mb-8">
        <CardHeader 
          title="Live Positions" 
          subtitle="No active positions"
          icon={<Target className="w-5 h-5" />}
        />
        <Card className="mt-4">
          <p className="text-foreground-tertiary text-sm text-center py-8">
            No live positions. Waiting for Download Money high-confidence signals...
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <CardHeader 
        title={`Live Positions (${btcPositions.length})`}
        icon={<Target className="w-5 h-5" />}
      />
      
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {btcPositions.map(position => (
          <PositionCard 
            key={position.id} 
            position={position} 
            onClose={onClosePosition}
            onClick={() => handlePositionClick(position)}
          />
        ))}
      </div>
      
      {/* Predictions Modal */}
      {selectedPosition && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-bg-primary border border-border-default rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold">Signal Context</h3>
                <p className="text-sm text-foreground-tertiary">
                  {selectedPosition.symbol} - {selectedPosition.side.toUpperCase()} @ ${formatPrice(selectedPosition.entry_price)}
                </p>
              </div>
              <button
                onClick={closePredictionsModal}
                className="p-2 rounded-lg hover:bg-surface-2 transition-colors"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            
            {loadingPredictions ? (
              <div className="text-center py-8 text-foreground-tertiary">
                Loading signals...
              </div>
            ) : predictions.length === 0 ? (
              <div className="text-center py-8 text-foreground-tertiary">
                No signals found for this position
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-4">
                  {predictions.map((prediction, index) => (
                    <div key={prediction.id} className="bg-surface-1 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="neutral" className="text-xs">
                            {prediction.timeframe}
                          </Badge>
                          <Badge 
                            variant={prediction.direction === 'up' ? 'success' : 'danger'} 
                            className="text-xs"
                          >
                            {prediction.direction.toUpperCase()}
                          </Badge>
                          <Badge variant="neutral" className="text-xs">
                            {prediction.confidence.toFixed(0)}%
                          </Badge>
                        </div>
                        <span className="text-xs text-foreground-tertiary">
                          {formatVietnamTime(prediction.predicted_at)}
                        </span>
                      </div>
                      
                      {prediction.reason_summary && (
                        <p className="text-sm text-foreground-tertiary mb-2">
                          {prediction.reason_summary}
                        </p>
                      )}
                      
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-foreground-tertiary block">Entry</span>
                          <span className="font-mono">${formatPrice(prediction.suggested_entry)}</span>
                        </div>
                        <div>
                          <span className="text-foreground-tertiary block">SL</span>
                          <span className="font-mono text-danger">${formatPrice(prediction.suggested_stop_loss)}</span>
                        </div>
                        <div>
                          <span className="text-foreground-tertiary block">TP</span>
                          <span className="font-mono text-success">${formatPrice(prediction.suggested_take_profit)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Pagination */}
                {totalPredictions > 5 && (
                  <div className="flex items-center justify-between pt-4 border-t border-border-default">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchPredictions(selectedPosition.id, predictionPage - 1)}
                      disabled={predictionPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Previous
                    </Button>
                    <span className="text-sm text-foreground-tertiary">
                      Page {predictionPage} of {Math.ceil(totalPredictions / 5)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchPredictions(selectedPosition.id, predictionPage + 1)}
                      disabled={predictionPage >= Math.ceil(totalPredictions / 5)}
                    >
                      Next
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PositionCard({ position, onClose, onClick }: { position: Position; onClose: (id: string) => Promise<{ success: boolean }>; onClick: () => void }) {
  const isLong = position.side === 'long';
  const pnlPercent = position.size_usd > 0 ? ((position.unrealized_pnl || 0) / position.size_usd) * 100 : 0;
  const isProfitable = pnlPercent >= 0;

  // SL/TP progress
  const slDistance = Math.abs(position.entry_price - position.stop_loss);
  const tpDistance = Math.abs(position.take_profit - position.entry_price);
  const totalDistance = slDistance + tpDistance;
  const currentDistance = isLong
    ? position.current_price - position.stop_loss
    : position.stop_loss - position.current_price;
  const progressPercent = totalDistance > 0 ? (currentDistance / totalDistance) * 100 : 0;

  return (
    <div className="relative rounded-lg border border-border-default bg-surface-0 p-4">
      {/* Close Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose(position.id);
        }}
        className="absolute top-3 right-3 p-1.5 rounded-lg text-foreground-tertiary hover:text-danger hover:bg-danger-dim transition-colors"
        title="Close position"
      >
        <XCircle className="w-5 h-5" />
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 pr-10">
        <div className="flex items-center gap-3">
          <Badge variant={isLong ? 'success' : 'danger'}>
            {isLong ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {position.side.toUpperCase()}
          </Badge>
          <span className="font-bold text-foreground text-lg">{position.symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-foreground-tertiary text-xs">Opened</span>
          <Badge variant="neutral" className="text-xs">
            {formatVietnamTime(position.entry_time)}
          </Badge>
        </div>
      </div>

      {/* PnL */}
      <div className="mb-4">
        <div className={cn('text-2xl font-bold font-mono', isProfitable ? 'text-success' : 'text-danger')}>
          {isProfitable ? '+' : ''}${formatPrice(position.unrealized_pnl || 0)}
        </div>
        <div className={cn('text-sm', isProfitable ? 'text-success/70' : 'text-danger/70')}>
          {isProfitable ? '+' : ''}{pnlPercent.toFixed(1)}%
        </div>
      </div>

      {/* Price Grid */}
      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div className="bg-surface-1 rounded-lg p-2">
          <span className="text-foreground-tertiary text-xs block">Entry</span>
          <span className="font-mono text-foreground">${formatPrice(position.entry_price)}</span>
        </div>
        <div className="bg-surface-1 rounded-lg p-2">
          <span className="text-foreground-tertiary text-xs block">Current</span>
          <span className="font-mono text-foreground">${formatPrice(position.current_price)}</span>
        </div>
        <div className="bg-danger-dim rounded-lg p-2">
          <span className="text-danger text-xs block">Stop Loss</span>
          <span className="font-mono text-danger">${formatPrice(position.stop_loss)}</span>
        </div>
        <div className="bg-success-dim rounded-lg p-2">
          <span className="text-success text-xs block">Take Profit</span>
          <span className="font-mono text-success">${formatPrice(position.take_profit)}</span>
        </div>
      </div>

      {/* Fees */}
      <div className="bg-surface-1 rounded-lg p-3 mb-4">
        <div className="text-xs text-foreground-tertiary mb-2">Fees</div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-foreground-tertiary block">Entry Fee</span>
            <span className="font-mono text-foreground">${formatPrice((position as any).entry_fee || 0)}</span>
          </div>
          <div>
            <span className="text-foreground-tertiary block">Exit Fee</span>
            <span className="font-mono text-foreground">${formatPrice((position as any).exit_fee || 0)}</span>
          </div>
          <div>
            <span className="text-foreground-tertiary block">Funding Fee</span>
            <span className="font-mono text-foreground">${formatPrice((position as any).funding_fee || 0)}</span>
          </div>
        </div>
      </div>

      {/* SL/TP Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-foreground-tertiary mb-1">
          <span>SL</span>
          <span>Progress</span>
          <span>TP</span>
        </div>
        <div className="relative h-2 bg-surface-2 rounded-full overflow-hidden">
          <div
            className={cn(
              'absolute h-full transition-all rounded-full',
              isProfitable ? 'bg-success' : 'bg-danger'
            )}
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          />
          {/* Entry marker */}
          <div
            className="absolute top-0 w-0.5 h-full bg-foreground"
            style={{ left: `${(slDistance / totalDistance) * 100}%` }}
          />
        </div>
      </div>

      {/* View Predictions Button */}
      <div className="mb-3">
        <button
          onClick={onClick}
          className="group relative w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-accent-primary/20 to-accent-secondary/20 hover:from-accent-primary/30 hover:to-accent-secondary/30 border border-accent-primary/30 rounded-lg transition-all duration-200"
        >
          <Brain className="w-4 h-4 text-accent-primary group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-accent-primary">View Download Money Signals</span>

          {/* Hover Tooltip */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-surface-3 border border-border-default rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
            <div className="flex items-center gap-2 text-xs text-foreground">
              <Info className="w-3 h-3 text-accent-primary" />
              <span>Click to view signal analysis for this position</span>
            </div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-surface-3" />
          </div>
        </button>
      </div>

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-foreground-tertiary pt-3 border-t border-border-default">
        <span>Size: ${formatPrice(position.size_usd)}</span>
        <span>Risk: {position.risk_percent}%</span>
        <span>R:R {position.expected_rr?.toFixed(1)}</span>
      </div>
    </div>
  );
}
