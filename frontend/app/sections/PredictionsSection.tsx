'use client';

import { useState, useEffect } from 'react';
import { Brain, TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { cn, formatPrice } from '@/lib/utils';
import type { PredictionHistory, ApiResponse, Analysis } from '../types';

const tfLabels: Record<string, string> = {
  '15m': '15p',
  '1h': '1g',
  '4h': '4g',
  '1d': '1ng'
};

const biasLabels: Record<string, string> = {
  'bullish': 'Tăng',
  'bearish': 'Giảm',
  'neutral': 'Trung lập'
};

interface PredictionsSectionProps {
  symbol: string;
  method?: string;
}

// Extended prediction with analysis data
interface PredictionWithAnalysis extends PredictionHistory {
  bias?: Analysis['bias'];
  confidence_score?: number;
  narrative_vi?: string;
  predicted_at?: string;
  suggested_entry?: number;
  suggested_stop_loss?: number;
  suggested_take_profit?: number;
  breakout_retest?: {
    has_breakout?: boolean;
    is_fake?: boolean;
    retest_pending?: boolean;
    analysis?: string;
  };
  position_decisions?: {
    recommendations?: Array<{
      position_id?: string;
      action?: string;
      confidence?: number;
      reason?: string;
      risk_percent?: number;
      pnl_percent?: number;
      pnl_usd?: number;
      current_entry?: number;
      current_sl?: number;
      current_tp?: number;
    }>;
    overall_strategy?: string;
  };
  alternative_scenario?: {
    trigger?: string;
    new_bias?: string;
    new_entry?: number;
    new_sl?: number;
    new_tp?: number;
    logic?: string;
  };
}

export function PredictionsSection({ symbol, method = 'kim_nghia' }: PredictionsSectionProps) {
  const [predictions, setPredictions] = useState<PredictionWithAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPredictions = async () => {
      try {
        const API_BASE = process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3000/api' 
          : '/api';
        const response = await fetch(`${API_BASE}/predictions/${symbol}?limit=20&method=${method}`);
        const data = await response.json();
        if (data.success && data.data) {
          // Flatten predictions from all analyses like old frontend
          const flattened = data.data.flatMap((analysis: any) => {
            const analysisData = {
              id: `analysis-${analysis.id}`,
              analysis_id: analysis.id,
              timestamp: analysis.timestamp,
              current_price: analysis.current_price,
              bias: analysis.bias,
              confidence_score: analysis.confidence,
              narrative_vi: analysis.narrative,
              breakout_retest: analysis.breakout_retest ? JSON.parse(analysis.breakout_retest) : undefined,
              position_decisions: analysis.position_decisions ? JSON.parse(analysis.position_decisions) : undefined,
              alternative_scenario: analysis.alternative_scenario ? JSON.parse(analysis.alternative_scenario) : undefined
            };
            
            if (!analysis.predictions || analysis.predictions.length === 0) {
              return [analysisData as PredictionWithAnalysis];
            }
            
            // Only show 1h timeframe predictions
            return analysis.predictions
              .filter((p: any) => p.timeframe === '1h')
              .map((pred: any) => ({
                ...analysisData,
                ...pred,
                predicted_at: analysis.timestamp,
                id: `${analysis.id}-${pred.timeframe}`,
                reasoning: pred.reason_summary || analysis.narrative
              } as PredictionWithAnalysis));
          });
          
          console.log('[PredictionTimeline] Flattened:', flattened.length);
          setPredictions(flattened);
        }
      } catch (err) {
        console.error('Error fetching predictions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPredictions();
  }, [symbol, method]);

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
          subtitle="1H timeframe predictions"
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
        subtitle={`${symbol} 1H timeframe predictions & outcomes`}
        icon={<Brain className="w-5 h-5" />}
      />
      
      <Card className="mt-4" padding="none">
        <div className="space-y-3 p-4">
          {predictions.map((prediction, index) => (
            <PredictionItem 
              key={prediction.id} 
              prediction={prediction}
              index={index}
              total={predictions.length}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

function PredictionItem({ 
  prediction,
  index,
  total
}: { 
  prediction: PredictionWithAnalysis;
  index: number;
  total: number;
}) {
  // Use bias from analysis (bullish/bearish/neutral)
  const bias = prediction.bias || 'neutral';
  
  const getBiasIcon = (bias: string) => {
    switch (bias) {
      case 'bullish': return TrendingUp;
      case 'bearish': return TrendingDown;
      default: return Minus;
    }
  };
  
  const getBiasColor = (bias: string) => {
    switch (bias) {
      case 'bullish': return 'text-emerald-600 bg-emerald-100';
      case 'bearish': return 'text-rose-600 bg-rose-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };
  
  const getNodeColor = (bias: string) => {
    switch (bias) {
      case 'bullish': return 'bg-emerald-500 border-emerald-600';
      case 'bearish': return 'bg-rose-500 border-rose-600';
      default: return 'bg-gray-400 border-gray-500';
    }
  };
  
  const getOutcomeColor = (outcome: string | null) => {
    switch (outcome) {
      case 'win': return 'text-emerald-600';
      case 'loss': return 'text-rose-600';
      case 'neutral': return 'text-gray-600';
      case 'pending': return 'text-yellow-600';
      default: return 'text-gray-400';
    }
  };
  
  const formatDateTime = (timestamp: string) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    // Add 7 hours offset to convert UTC to GMT+7
    const gmt7Date = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return gmt7Date.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  const formatPnL = (pnl: number | null) => {
    if (pnl === undefined || pnl === null) return 'N/A';
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toFixed(2)}`;
  };

  const BiasIcon = getBiasIcon(bias);
  const outcome = prediction.linked_position_id
    ? (prediction.outcome || 'pending')
    : (prediction.outcome || '-');

  return (
    <div className="relative pl-6">
      {/* Timeline line */}
      {index < total - 1 && (
        <div className="absolute left-2 top-8 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />
      )}

      {/* Timeline node */}
      <div className="absolute left-0 top-1">
        <div className={`w-4 h-4 rounded-full border-2 ${getNodeColor(bias)}`} />
      </div>

      {/* Prediction card */}
      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 transition-all hover:shadow-md">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            {/* Bias badge */}
            <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${getBiasColor(bias)}`}>
              <BiasIcon size={12} />
              <span>{biasLabels[bias] || bias}</span>
            </div>
            {/* Timeframe */}
            {prediction.timeframe && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {tfLabels[prediction.timeframe] || prediction.timeframe}
              </span>
            )}
          </div>
          {/* Timestamp */}
          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <Clock size={12} />
            {formatDateTime(prediction.predicted_at || prediction.timestamp)}
          </div>
        </div>

        {/* Grid: Giá, Conf, Outcome */}
        <div className="grid grid-cols-3 gap-2 text-xs mb-2">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Giá:</span>
            <span className="ml-1 font-medium text-gray-900 dark:text-gray-100">
              ${formatPrice(prediction.current_price)}
            </span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Conf:</span>
            <span className="ml-1 font-medium text-gray-900 dark:text-gray-100">
              {Math.round((prediction.confidence_score || prediction.confidence || 0) * 100)}%
            </span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Outcome:</span>
            <span className={`ml-1 font-medium ${getOutcomeColor(prediction.outcome)}`}>
              {outcome}
            </span>
          </div>
        </div>

        {/* PnL */}
        {prediction.pnl !== undefined && prediction.pnl !== null && (
          <div className="text-xs mb-2">
            <span className="text-gray-500 dark:text-gray-400">PnL:</span>
            <span className={`ml-1 font-medium ${prediction.pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {formatPnL(prediction.pnl)}
            </span>
          </div>
        )}

        {/* Reason/Narrative */}
        {prediction.narrative_vi && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium text-gray-900 dark:text-gray-100">Lý do:</span>{' '}
              <span className="text-gray-600 dark:text-gray-400">{prediction.narrative_vi}</span>
            </div>
          </div>
        )}

        {/* Entry/SL/TP levels */}
        {(prediction.suggested_entry || prediction.suggested_stop_loss || prediction.suggested_take_profit) && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {prediction.suggested_entry && (
              <span className="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                Entry: ${formatPrice(prediction.suggested_entry)}
              </span>
            )}
            {prediction.suggested_stop_loss && (
              <span className="px-2 py-1 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 rounded">
                SL: ${formatPrice(prediction.suggested_stop_loss)}
              </span>
            )}
            {prediction.suggested_take_profit && (
              <span className="px-2 py-1 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded">
                TP: ${formatPrice(prediction.suggested_take_profit)}
              </span>
            )}
          </div>
        )}

        {/* Breakout/Retest Analysis (Kim Nghia) */}
        {prediction.breakout_retest && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <div className="text-xs">
              <span className="font-medium text-gray-900 dark:text-gray-100">Breakout/Retest:</span>
              {prediction.breakout_retest.has_breakout && (
                <span className="ml-2 px-2 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                  {prediction.breakout_retest.is_fake ? 'Fake' : 'Real'} Breakout
                </span>
              )}
              {prediction.breakout_retest.retest_pending && (
                <span className="ml-2 px-2 py-0.5 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded">
                  Retest Pending
                </span>
              )}
              {prediction.breakout_retest.analysis && (
                <div className="mt-1 text-gray-600 dark:text-gray-400">
                  {prediction.breakout_retest.analysis}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Position Decisions (Kim Nghia) */}
        {prediction.position_decisions?.recommendations && prediction.position_decisions.recommendations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <div className="text-xs">
              <span className="font-medium text-gray-900 dark:text-gray-100">Đề xuất vị thế:</span>
              {(() => {
                // Group recommendations by action to avoid duplicates
                const grouped: Record<string, any> = {};
                prediction.position_decisions.recommendations.forEach((rec) => {
                  if (rec.action && !grouped[rec.action]) {
                    grouped[rec.action] = rec;
                  }
                });
                return Object.values(grouped);
              })().map((rec, idx) => (
                <div key={idx} className="mt-1 p-2 bg-gray-50 dark:bg-gray-700/50 rounded">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                      {rec.action}
                    </span>
                    {rec.pnl_usd !== undefined && rec.pnl_usd !== null && (
                      <span className={`text-xs font-medium ${rec.pnl_usd >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        PnL: ${rec.pnl_usd.toFixed(2)} ({rec.pnl_percent?.toFixed(2)}%)
                      </span>
                    )}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">{rec.reason}</div>
                  {rec.current_entry && (
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                      Entry: ${formatPrice(rec.current_entry)} | SL: ${formatPrice(rec.current_sl)} | TP: ${formatPrice(rec.current_tp)}
                    </div>
                  )}
                </div>
              ))}
              {prediction.position_decisions.overall_strategy && (
                <div className="mt-2 text-gray-600 dark:text-gray-400 italic">
                  {prediction.position_decisions.overall_strategy}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Alternative Scenario (Kim Nghia) */}
        {prediction.alternative_scenario && prediction.alternative_scenario.trigger && (
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            <div className="text-xs">
              <span className="font-medium text-gray-900 dark:text-gray-100">Kịch bản đảo chiều:</span>
              <div className="mt-1 p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                <div className="text-gray-700 dark:text-gray-300 mb-1">
                  <span className="font-medium">Trigger:</span> {prediction.alternative_scenario.trigger}
                </div>
                {prediction.alternative_scenario.new_bias && (
                  <div className="text-gray-700 dark:text-gray-300 mb-1">
                    <span className="font-medium">New Bias:</span> {prediction.alternative_scenario.new_bias}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 text-xs mt-1">
                  {prediction.alternative_scenario.new_entry && (
                    <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                      Entry: ${formatPrice(prediction.alternative_scenario.new_entry)}
                    </span>
                  )}
                  {prediction.alternative_scenario.new_sl && (
                    <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 rounded">
                      SL: ${formatPrice(prediction.alternative_scenario.new_sl)}
                    </span>
                  )}
                  {prediction.alternative_scenario.new_tp && (
                    <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded">
                      TP: ${formatPrice(prediction.alternative_scenario.new_tp)}
                    </span>
                  )}
                </div>
                {prediction.alternative_scenario.logic && (
                  <div className="mt-2 text-gray-600 dark:text-gray-400 text-xs">
                    {prediction.alternative_scenario.logic}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
