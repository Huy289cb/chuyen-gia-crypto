import { Activity, Clock, BarChart3, RefreshCw } from 'lucide-react';

function formatNumber(num) {
  if (!num || isNaN(num)) return 'N/A';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

export function MarketOverview({ analysis, lastUpdated, marketData }) {
  // Guard against undefined/null/empty analysis during loading
  if (!analysis || typeof analysis !== 'object' || Object.keys(analysis).length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-3 sm:p-4 border border-gray-100">
        <div className="flex items-center gap-2">
          <Activity className="text-purple-500" size={18} />
          <h3 className="font-bold text-sm sm:text-base text-gray-900">Tổng quan thị trường</h3>
        </div>
        <p className="text-xs text-gray-500 mt-2">Đang tải dữ liệu...</p>
      </div>
    );
  }
  
  try {
    const sentiment = analysis?.marketSentiment || 'neutral';
    const comparison = analysis?.comparison || '';
  
  const sentimentConfig = {
    bullish: { color: 'bg-green-500', text: 'Tăng', bg: 'bg-green-50', textColor: 'text-green-700' },
    bearish: { color: 'bg-red-500', text: 'Giảm', bg: 'bg-red-50', textColor: 'text-red-700' },
    neutral: { color: 'bg-gray-400', text: 'Trung lập', bg: 'bg-gray-50', textColor: 'text-gray-700' },
    mixed: { color: 'bg-yellow-500', text: 'Hỗn hợp', bg: 'bg-yellow-50', textColor: 'text-yellow-700' }
  };
  
  const config = sentimentConfig[sentiment] || sentimentConfig.neutral;

  const formatTime = (isoString) => {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString('vi-VN', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit'
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-3 sm:p-4 border border-gray-100">
      {/* Header row with stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="text-purple-500" size={18} />
          <h3 className="font-bold text-sm sm:text-base text-gray-900">Tổng quan thị trường</h3>
          <div className={`px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg ${config.bg} flex items-center gap-1.5 sm:gap-2 shrink-0`}>
            <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${config.color}`}></div>
            <span className={`text-xs sm:text-sm font-semibold ${config.textColor}`}>{config.text}</span>
          </div>
        </div>
        
        {marketData && (
          <div className="flex items-center gap-2 sm:gap-4 text-xs flex-wrap">
            {marketData?.fearGreed?.value !== undefined && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">F&G:</span>
                <span className={`font-semibold ${marketData.fearGreed.value > 50 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {marketData.fearGreed.value}
                </span>
                <span className="text-gray-400">({marketData.fearGreed.classification})</span>
              </div>
            )}
            {marketData?.totalVolume && (
              <div className="flex items-center gap-1.5">
                <BarChart3 size={12} className="text-gray-400" />
                <span className="text-gray-500">Vol 24h:</span>
                <span className="font-semibold text-blue-600">{formatNumber(marketData.totalVolume)}</span>
              </div>
            )}
            {marketData?.btcDominance && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">BTC Dom:</span>
                <span className="font-semibold text-orange-500">{marketData.btcDominance.toFixed(1)}%</span>
              </div>
            )}
            <div className="flex items-center gap-1 text-gray-400 border-l border-gray-200 pl-3 ml-1">
              <Clock size={12} />
              <span>{formatTime(lastUpdated)}</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Sentiment & Comparison row */}
      <div className="flex items-start gap-3">
        
        {comparison && (
          <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">
            {comparison}
          </p>
        )}
      </div>
    </div>
  );
  } catch (error) {
    console.error('MarketOverview error:', error);
    return (
      <div className="bg-white rounded-xl shadow-sm p-3 sm:p-4 border border-gray-100">
        <div className="flex items-center gap-2">
          <Activity className="text-purple-500" size={18} />
          <h3 className="font-bold text-sm sm:text-base text-gray-900">Tổng quan thị trường</h3>
        </div>
        <p className="text-xs text-red-500 mt-2">Lỗi hiển thị dữ liệu</p>
      </div>
    );
  }
}

export function RefreshButton({ onRefresh, loading }) {
  return (
    <button
      onClick={onRefresh}
      disabled={loading}
      className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium text-xs sm:text-sm transition-all ${
        loading 
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
          : 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95'
      }`}
    >
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">{loading ? 'Đang tải...' : 'Làm mới'}</span>
    </button>
  );
}
