import { useState } from 'react';
import { History, TrendingUp, TrendingDown, XCircle, Target, AlertCircle } from 'lucide-react';

export function TradeHistoryPanel({ trades }) {
  const [selectedTrade, setSelectedTrade] = useState(null);

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <History className="w-5 h-5 text-gray-500" />
          Lịch Sử Giao Dịch
        </h3>
        <p className="text-gray-500 text-sm">Chưa có giao dịch nào</p>
      </div>
    );
  }

  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
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
    if (pnl === undefined || pnl === null) return 'N/A';
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toFixed(2)}`;
  };

  const getTradeOutcome = (trade) => {
    if (trade.realized_pnl > 0) return { type: 'win', label: 'Thắng', color: 'text-emerald-600 bg-emerald-100' };
    if (trade.realized_pnl < 0) return { type: 'loss', label: 'Thua', color: 'text-rose-600 bg-rose-100' };
    return { type: 'neutral', label: 'Hòa', color: 'text-gray-600 bg-gray-100' };
  };

  const getCloseReasonIcon = (reason) => {
    switch (reason) {
      case 'stop_loss':
        return <AlertCircle className="w-4 h-4 text-rose-500" />;
      case 'take_profit':
        return <Target className="w-4 h-4 text-emerald-500" />;
      case 'manual':
        return <XCircle className="w-4 h-4 text-gray-500" />;
      default:
        return null;
    }
  };

  const getCloseReasonLabel = (reason) => {
    switch (reason) {
      case 'stop_loss':
        return 'Stop Loss';
      case 'take_profit':
        return 'Take Profit';
      case 'manual':
        return 'Thủ công';
      case 'account_reset':
        return 'Reset tài khoản';
      default:
        return reason || 'Không xác định';
    }
  };

  return (
    <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <History className="w-5 h-5 text-gray-500" />
        Lịch Sử Giao Dịch ({trades.length})
      </h3>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {trades.map((trade) => {
          const outcome = getTradeOutcome(trade);
          const isLong = trade.side === 'long';
          
          return (
            <div
              key={trade.id}
              className={`border rounded-lg p-3 cursor-pointer transition-all hover:shadow-md ${
                selectedTrade === trade.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
              }`}
              onClick={() => setSelectedTrade(selectedTrade === trade.id ? null : trade.id)}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${isLong ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {isLong ? 'LONG' : 'SHORT'}
                  </span>
                  <span className="font-semibold text-gray-900">{trade.symbol}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcome.color}`}>
                    {outcome.label}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  {getCloseReasonIcon(trade.close_reason)}
                  <span>{getCloseReasonLabel(trade.close_reason)}</span>
                </div>
              </div>

              {/* Prices */}
              <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                <div>
                  <span className="text-gray-500">Entry:</span>
                  <span className="ml-1 font-medium">{formatPrice(trade.entry_price)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Exit:</span>
                  <span className="ml-1 font-medium">{formatPrice(trade.close_price)}</span>
                </div>
                <div>
                  <span className="text-gray-500">PnL:</span>
                  <span className={`ml-1 font-medium ${trade.realized_pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatPnL(trade.realized_pnl)}
                  </span>
                </div>
              </div>

              {/* Times */}
              <div className="flex justify-between text-xs text-gray-500">
                <span>Mở: {formatDateTime(trade.entry_time)}</span>
                <span>Đóng: {formatDateTime(trade.close_time)}</span>
              </div>

              {/* Expanded details */}
              {selectedTrade === trade.id && (
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-gray-500">Stop Loss:</span>
                      <span className="ml-1 font-medium text-rose-600">{formatPrice(trade.stop_loss)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Take Profit:</span>
                      <span className="ml-1 font-medium text-emerald-600">{formatPrice(trade.take_profit)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Kích thước:</span>
                      <span className="ml-1 font-medium">${trade.size_usd?.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">R:R:</span>
                      <span className="ml-1 font-medium">{trade.expected_rr?.toFixed(1)}</span>
                    </div>
                  </div>
                  {trade.position_id && (
                    <div className="text-gray-400">
                      ID: {trade.position_id}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
