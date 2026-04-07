import { DollarSign, TrendingUp, TrendingDown, Activity } from 'lucide-react';

export function DashboardHeader({ accounts }) {
  const btcAccount = accounts.find(a => a.symbol === 'BTC');
  const ethAccount = accounts.find(a => a.symbol === 'ETH');

  const totalEquity = accounts.reduce((sum, acc) => sum + (acc.equity || 0), 0);
  const totalStarting = accounts.reduce((sum, acc) => sum + (acc.starting_balance || 0), 0);
  const totalReturn = ((totalEquity - totalStarting) / totalStarting) * 100;
  const totalRealizedPnl = accounts.reduce((sum, acc) => sum + (acc.realized_pnl || 0), 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
      {/* BTC Equity */}
      <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs sm:text-sm font-medium text-gray-600">BTC Equity</span>
          <DollarSign className="w-4 h-4 text-orange-500" />
        </div>
        <div className="text-lg sm:text-xl font-bold text-gray-900">
          ${btcAccount?.equity?.toFixed(2) || '0.00'}
        </div>
        <div className={`text-xs ${btcAccount?.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {btcAccount?.realized_pnl >= 0 ? '+' : ''}{btcAccount?.realized_pnl?.toFixed(2) || '0.00'} PnL
        </div>
      </div>

      {/* ETH Equity */}
      <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs sm:text-sm font-medium text-gray-600">ETH Equity</span>
          <DollarSign className="w-4 h-4 text-blue-500" />
        </div>
        <div className="text-lg sm:text-xl font-bold text-gray-900">
          ${ethAccount?.equity?.toFixed(2) || '0.00'}
        </div>
        <div className={`text-xs ${ethAccount?.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {ethAccount?.realized_pnl >= 0 ? '+' : ''}{ethAccount?.realized_pnl?.toFixed(2) || '0.00'} PnL
        </div>
      </div>

      {/* Total Return */}
      <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs sm:text-sm font-medium text-gray-600">Total Return</span>
          {totalReturn >= 0 ? (
            <TrendingUp className="w-4 h-4 text-green-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-500" />
          )}
        </div>
        <div className={`text-lg sm:text-xl font-bold ${totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {totalReturn >= 0 ? '+' : ''}{totalReturn.toFixed(2)}%
        </div>
        <div className="text-xs text-gray-500">
          ${totalEquity.toFixed(2)} / ${totalStarting.toFixed(2)}
        </div>
      </div>

      {/* Total Trades */}
      <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs sm:text-sm font-medium text-gray-600">Total Trades</span>
          <Activity className="w-4 h-4 text-purple-500" />
        </div>
        <div className="text-lg sm:text-xl font-bold text-gray-900">
          {accounts.reduce((sum, acc) => sum + (acc.total_trades || 0), 0)}
        </div>
        <div className="text-xs text-gray-500">
          Win Rate: {calculateOverallWinRate(accounts)}%
        </div>
      </div>
    </div>
  );
}

function calculateOverallWinRate(accounts) {
  const totalTrades = accounts.reduce((sum, acc) => sum + (acc.total_trades || 0), 0);
  const totalWins = accounts.reduce((sum, acc) => sum + (acc.winning_trades || 0), 0);
  if (totalTrades === 0) return 0;
  return ((totalWins / totalTrades) * 100).toFixed(0);
}
