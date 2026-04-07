import { XCircle } from 'lucide-react';

export function PositionPanel({ positions, onClosePosition }) {
  if (positions.length === 0) {
    return (
      <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200">
        <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Open Positions</h3>
        <p className="text-gray-500 text-sm">No open positions</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200">
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Open Positions ({positions.length})</h3>
      <div className="space-y-3">
        {positions.map((position) => (
          <PositionCard key={position.id} position={position} onClose={onClosePosition} />
        ))}
      </div>
    </div>
  );
}

function PositionCard({ position, onClose }) {
  const isLong = position.side === 'long';
  const pnlPercent = position.size_usd > 0 ? ((position.unrealized_pnl || 0) / position.size_usd) * 100 : 0;
  const isProfitable = pnlPercent >= 0;

  const slDistance = Math.abs(position.entry_price - position.stop_loss);
  const tpDistance = Math.abs(position.take_profit - position.entry_price);
  const totalDistance = slDistance + tpDistance;

  const currentProgress = totalDistance > 0 
    ? (isLong 
        ? ((position.entry_price - position.stop_loss) / totalDistance) * 100
        : ((position.stop_loss - position.entry_price) / totalDistance) * 100)
    : 0;

  return (
    <div className="border border-gray-200 rounded-lg p-3 sm:p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${isLong ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {position.side.toUpperCase()}
          </span>
          <span className="font-semibold text-gray-900">{position.symbol}</span>
        </div>
        <button
          onClick={() => onClose(position.id)}
          className="text-gray-400 hover:text-red-500 transition-colors"
          title="Close position"
        >
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <span className="text-gray-500">Entry:</span>
          <span className="ml-1 font-medium">${position.entry_price?.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-500">Current:</span>
          <span className="ml-1 font-medium">${(position.entry_price + (isLong ? (position.unrealized_pnl || 0) / (position.size_qty || 1) : -(position.unrealized_pnl || 0) / (position.size_qty || 1)))?.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-500">SL:</span>
          <span className="ml-1 font-medium text-red-600">${position.stop_loss?.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-500">TP:</span>
          <span className="ml-1 font-medium text-green-600">${position.take_profit?.toLocaleString()}</span>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>PnL</span>
          <span className={isProfitable ? 'text-green-600' : 'text-red-600'}>
            {isProfitable ? '+' : ''}${position.unrealized_pnl?.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
          </span>
        </div>
      </div>

      <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`absolute h-full transition-all ${isProfitable ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${Math.min(100, Math.max(0, currentProgress))}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>SL</span>
        <span>TP</span>
      </div>

      <div className="text-xs text-gray-500 mt-2">
        Size: ${position.size_usd?.toFixed(2)} | Risk: {position.risk_percent}% | R:R {position.expected_rr?.toFixed(1)}
      </div>
    </div>
  );
}
