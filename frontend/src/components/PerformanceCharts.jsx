import { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Activity, DollarSign, Clock, Calendar } from 'lucide-react';

const API_BASE = import.meta.env.API_URL || 'http://localhost:3000/api';

export function PerformanceCharts({ symbol, hours = 168 }) {
  const [performance, setPerformance] = useState(null);
  const [equityCurve, setEquityCurve] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('equity'); // equity, stats, trades

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch performance metrics
        const perfRes = await fetch(`${API_BASE}/performance?symbol=${symbol}`);
        const perfData = await perfRes.json();
        if (perfData.success) {
          setPerformance(perfData.data);
        }

        // Fetch equity curve
        const equityRes = await fetch(`${API_BASE}/performance/equity-curve?symbol=${symbol}&hours=${hours}`);
        const equityData = await equityRes.json();
        if (equityData.success) {
          setEquityCurve(equityData.data);
        }

        // Fetch trade history
        const tradesRes = await fetch(`${API_BASE}/performance/trades?symbol=${symbol}&limit=50`);
        const tradesData = await tradesRes.json();
        if (tradesData.success) {
          setTrades(tradesData.data);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [symbol, hours]);

  const formatPrice = (price) => {
    if (!price) return 'N/A';
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

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

  const formatDuration = (entryTime, closeTime) => {
    if (!entryTime || !closeTime) return 'N/A';
    const entry = new Date(entryTime);
    const close = new Date(closeTime);
    const diffMs = close - entry;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${diffHours}h ${diffMins}m`;
  };

  // Prepare equity curve data
  const equityChartData = equityCurve.map(snapshot => ({
    time: new Date(snapshot.timestamp).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
    equity: snapshot.equity,
    balance: snapshot.balance
  }));

  // Prepare trade stats data
  const tradeStatsData = [
    {
      name: 'Wins',
      value: performance?.winning_trades || 0,
      color: '#10b981'
    },
    {
      name: 'Losses',
      value: performance?.losing_trades || 0,
      color: '#ef4444'
    }
  ];

  // Prepare profit per trade data
  const profitPerTradeData = trades.slice(0, 10).map(trade => ({
    name: formatDateTime(trade.entry_time),
    profit: trade.realized_pnl || 0
  }));

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-500">Đang tải dữ liệu hiệu suất...</div>
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

  return (
    <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base sm:text-lg font-bold text-gray-900">Hiệu Suất {symbol}</h3>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={(e) => window.location.href = `${API_BASE}/performance/equity-curve?symbol=${symbol}&hours=${e.target.value}`}
            className="px-3 py-1.5 bg-gray-100 rounded-lg text-sm"
          >
            <option value="24">24h</option>
            <option value="168">7 ngày</option>
            <option value="720">30 ngày</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-xs text-gray-600 mb-1">Equity</div>
          <div className="text-lg font-bold text-gray-900">${(performance?.current_equity || 0).toFixed(2)}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-xs text-gray-600 mb-1">Total Return</div>
          <div className={`text-lg font-bold ${performance?.total_return_percent >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {performance?.total_return_percent >= 0 ? '+' : ''}{(performance?.total_return_percent || 0).toFixed(2)}%
          </div>
        </div>
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-xs text-gray-600 mb-1">Win Rate</div>
          <div className="text-lg font-bold text-gray-900">{performance?.win_rate?.toFixed(0) || 0}%</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-xs text-gray-600 mb-1">Profit Factor</div>
          <div className="text-lg font-bold text-gray-900">{(performance?.profit_factor || 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 mb-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('equity')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'equity' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Equity Curve
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'stats' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Trade Stats
        </button>
        <button
          onClick={() => setActiveTab('trades')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'trades' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Trade History
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'equity' && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <TrendingUp size={16} />
              Equity Curve
            </h4>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} name="Equity" />
                  <Line type="monotone" dataKey="balance" stroke="#10b981" strokeWidth={2} name="Balance" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <Activity size={16} />
              Win/Loss Ratio
            </h4>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tradeStatsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {tradeStatsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                  <Bar dataKey="value" name="Trades" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <DollarSign size={16} />
              Profit per Trade (Last 10)
            </h4>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={profitPerTradeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="profit" name="Profit ($)">
                    {profitPerTradeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-600 mb-1">Avg R Multiple</div>
              <div className="text-lg font-bold text-gray-900">{(performance?.average_r_multiple || 0).toFixed(2)}R</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl">
              <div className="text-xs text-gray-600 mb-1">Max Drawdown</div>
              <div className="text-lg font-bold text-rose-600">{(performance?.max_drawdown || 0).toFixed(2)}%</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'trades' && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Clock size={16} />
            Trade History
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Date</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Side</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">Entry</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">Exit</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">PnL</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">RR</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-900">{formatDateTime(trade.entry_time)}</td>
                    <td className={`py-2 px-3 font-medium ${trade.side === 'long' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {trade.side.toUpperCase()}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-900">{formatPrice(trade.entry_price)}</td>
                    <td className="py-2 px-3 text-right text-gray-900">{formatPrice(trade.close_price)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${trade.realized_pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatPrice(trade.realized_pnl)}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-900">{(trade.expected_rr || 0).toFixed(1)}R</td>
                    <td className="py-2 px-3 text-right text-gray-600">{formatDuration(trade.entry_time, trade.close_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trades.length === 0 && (
            <div className="text-center py-8 text-gray-500">Chưa có giao dịch nào</div>
          )}
        </div>
      )}
    </div>
  );
}
