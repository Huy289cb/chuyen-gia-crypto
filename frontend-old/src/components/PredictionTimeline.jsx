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
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    const fetchPredictions = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`${API_BASE}/predictions/${symbol}?limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch predictions');
        
        const result = await response.json();
        if (result.success && result.data) {
          // Flatten predictions from all analyses
          // Each analysis has nested predictions array
          const flattenedPredictions = result.data.flatMap(analysis => {
            const analysisData = {
              id: `analysis-${analysis.id}`,
              analysis_id: analysis.id,
              timestamp: analysis.timestamp,
              current_price: analysis.current_price,
              bias: analysis.bias,
              confidence_score: analysis.confidence,
              narrative_vi: analysis.narrative
            };
            
            // If no predictions, return analysis as single item
            if (!analysis.predictions || analysis.predictions.length === 0) {
              return [analysisData];
            }
            
            // Map each prediction with analysis data - ONLY show 4h timeframe
            return analysis.predictions
              .filter(pred => pred.timeframe === '4h')
              .map(pred => ({
                ...analysisData,
                ...pred,
                predicted_at: analysis.timestamp,
                id: `${analysis.id}-${pred.timeframe}`
              }));
          });
          
          console.log('[PredictionTimeline] Flattened predictions:', flattenedPredictions.map(p => ({ 
            id: p.id, 
            timestamp: p.timestamp, 
            current_price: p.current_price,
            timeframe: p.timeframe 
          })));
          setPredictions(flattenedPredictions);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPredictions();
  }, [symbol, limit]);

  // Pagination logic
  const totalPages = Math.ceil(predictions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPredictions = predictions.slice(startIndex, endIndex);

  const goToPage = (page) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    // Ensure timestamp is parsed as UTC (backend sends "2026-04-13 16:45:28")
    const utcTimestamp = timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
    const date = new Date(utcTimestamp);
    // Convert to GMT+7
    const formatted = date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    console.log('[PredictionTimeline] Formatting:', timestamp, '->', utcTimestamp, '->', formatted);
    return formatted;
  };

  const formatPrice = (price) => {
    if (!price) return 'N/A';
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPnL = (pnl) => {
    if (pnl === undefined || pnl === null) return 'N/A';
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
      case '-': return 'text-gray-400';
      case 'pending': return 'text-yellow-600';
      default: return 'text-gray-400';
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

      {/* Timeline - Paginated */}
      <div className="space-y-3">
        {currentPredictions.map((pred, index) => {
          const BiasIcon = getBiasIcon(pred.bias);
          const actualIndex = startIndex + index;
          return (
            <div key={pred.id || actualIndex} className="relative pl-6">
              {/* Timeline line */}
              {actualIndex < predictions.length - 1 && (
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

              {/* Prediction card - No click to expand, show reason directly */}
              <div className="p-3 rounded-xl border border-gray-200 bg-white transition-all hover:shadow-md">
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
                      {pred.linked_position_id
                        ? (pred.outcome || 'pending')
                        : (pred.outcome || '-')}
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

                {/* Always show reason/narrative */}
                {pred.narrative_vi && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <div className="text-sm text-gray-700">
                      <span className="font-medium text-gray-900">Lý do:</span>{' '}
                      <span className="text-gray-600">{pred.narrative_vi}</span>
                    </div>
                  </div>
                )}

                {/* Entry/SL/TP levels */}
                {(pred.suggested_entry || pred.suggested_stop_loss || pred.suggested_take_profit) && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {pred.suggested_entry && (
                      <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">
                        Entry: {formatPrice(pred.suggested_entry)}
                      </span>
                    )}
                    {pred.suggested_stop_loss && (
                      <span className="px-2 py-1 bg-rose-50 text-rose-700 rounded">
                        SL: {formatPrice(pred.suggested_stop_loss)}
                      </span>
                    )}
                    {pred.suggested_take_profit && (
                      <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded">
                        TP: {formatPrice(pred.suggested_take_profit)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between pt-4 border-t border-gray-200">
          <div className="text-sm text-gray-500">
            Hiển thị {startIndex + 1}-{Math.min(endIndex, predictions.length)} / {predictions.length} dự báo
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentPage === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              ← Trước
            </button>
            <span className="text-sm text-gray-700">
              Trang {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentPage === totalPages
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Sau →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
