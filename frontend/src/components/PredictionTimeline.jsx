import { useState, useEffect } from 'react';
import { Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:3000/api'
  : '/api';

const tfLabels = {
  '15m': '15p',
  '1h': '1g',
  '4h': '4g',
  '1d': '1ng'
};

const biasLabels = {
  'bullish': 'Tăng',
  'bearish': 'Giảm',
  'neutral': 'Trung lập'
};

export function PredictionTimeline({ symbol, limit = 50 }) {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPrediction, setSelectedPrediction] = useState(null);

  useEffect(() => {
    const fetchPredictions = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`${API_BASE}/predictions/${symbol}?limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch predictions');
        
        const result = await response.json();
        if (result.success && result.data) {
          setPredictions(result.data);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPredictions();
  }, [symbol, limit]);

  const formatDateTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatPrice = (price) => {
    if (!price) return 'N/A';
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPnL = (pnl) => {
    if (!pnl) return 'N/A';
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toFixed(2)}`;
  };

  const getBiasColor = (bias) => {
    switch (bias) {
      case 'bullish': return 'text-emerald-600 bg-emerald-100';
      case 'bearish': return 'text-rose-600 bg-rose-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getBiasIcon = (bias) => {
    switch (bias) {
      case 'bullish': return TrendingUp;
      case 'bearish': return TrendingDown;
      default: return Minus;
    }
  };

  const getOutcomeColor = (outcome) => {
    switch (outcome) {
      case 'win': return 'text-emerald-600';
      case 'loss': return 'text-rose-600';
      case 'neutral': return 'text-gray-600';
      default: return 'text-yellow-600';
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-500">Đang tải lịch sử dự báo...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
        <div className="flex items-center justify-center py-8">
          <div className="text-rose-600">Lỗi: {error}</div>
        </div>
      </div>
    );
  }

  if (predictions.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-500">Chưa có dữ liệu dự báo</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-900">Lịch Sử Dự Báo</h3>
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {predictions.map((pred, index) => {
          const BiasIcon = getBiasIcon(pred.bias);
          return (
            <div key={pred.id || index} className="relative pl-6">
              {/* Timeline line */}
              {index < predictions.length - 1 && (
                <div className="absolute left-2 top-8 bottom-0 w-0.5 bg-gray-200" />
              )}

              {/* Timeline node */}
              <div className="absolute left-0 top-1">
                <div className={`w-4 h-4 rounded-full border-2 ${
                  pred.bias === 'bullish' ? 'bg-emerald-500 border-emerald-600' :
                  pred.bias === 'bearish' ? 'bg-rose-500 border-rose-600' :
                  'bg-gray-400 border-gray-500'
                }`} />
              </div>

              {/* Prediction card */}
              <div
                className={`p-3 rounded-xl border cursor-pointer transition-all hover:shadow-md ${
                  selectedPrediction === pred.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
                onClick={() => setSelectedPrediction(selectedPrediction === pred.id ? null : pred.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${getBiasColor(pred.bias)}`}>
                      <BiasIcon size={12} />
                      <span>{biasLabels[pred.bias] || pred.bias}</span>
                    </div>
                    {pred.timeframe && (
                      <span className="text-xs text-gray-500">{tfLabels[pred.timeframe] || pred.timeframe}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock size={12} />
                    {formatDateTime(pred.predicted_at || pred.timestamp)}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-gray-500">Giá:</span>
                    <span className="ml-1 font-medium text-gray-900">{formatPrice(pred.current_price)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Conf:</span>
                    <span className="ml-1 font-medium text-gray-900">{Math.round((pred.confidence_score || pred.confidence) * 100)}%</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Outcome:</span>
                    <span className={`ml-1 font-medium ${getOutcomeColor(pred.outcome)}`}>
                      {pred.outcome || 'pending'}
                    </span>
                  </div>
                </div>

                {pred.pnl !== undefined && pred.pnl !== null && (
                  <div className="text-xs mb-2">
                    <span className="text-gray-500">PnL:</span>
                    <span className={`ml-1 font-medium ${pred.pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatPnL(pred.pnl)}
                    </span>
                  </div>
                )}

                {/* Expanded details */}
                {selectedPrediction === pred.id && (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                    {pred.narrative_vi && (
                      <div className="text-sm text-gray-700">
                        <span className="font-medium">Lý do:</span> {pred.narrative_vi}
                      </div>
                    )}
                    {pred.reason_summary && (
                      <div className="text-sm text-gray-700">
                        <span className="font-medium">Tóm tắt:</span> {pred.reason_summary}
                      </div>
                    )}
                    {pred.suggested_entry && (
                      <div className="text-xs text-gray-600">
                        <span className="font-medium">Entry:</span> {formatPrice(pred.suggested_entry)}
                      </div>
                    )}
                    {pred.suggested_stop_loss && (
                      <div className="text-xs text-gray-600">
                        <span className="font-medium">SL:</span> {formatPrice(pred.suggested_stop_loss)}
                      </div>
                    )}
                    {pred.suggested_take_profit && (
                      <div className="text-xs text-gray-600">
                        <span className="font-medium">TP:</span> {formatPrice(pred.suggested_take_profit)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
