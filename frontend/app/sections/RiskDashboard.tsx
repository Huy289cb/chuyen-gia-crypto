/**
 * Risk Dashboard
 * Displays current risk state, daily PnL, consecutive losses, and trading status
 */

'use client';

import { useState, useEffect } from 'react';

interface RiskMetrics {
  config: {
    risk_per_trade_percent: number;
    daily_loss_limit_percent: number;
    max_consecutive_losses: number;
    consecutive_loss_cooldown_hours: number;
    min_signal_grade: string;
    min_signal_confidence: number;
    max_positions_per_symbol: number;
    max_total_positions: number;
  };
  daily_stats: {
    dailyPnL: number;
    consecutiveLosses: number;
  };
  trading_allowed: boolean;
  timestamp: string;
}

export default function RiskDashboard() {
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/metrics/risk');
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching risk metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !metrics) {
    return <div className="p-6 bg-white rounded-lg shadow">Loading risk metrics...</div>;
  }

  const { config, daily_stats, trading_allowed } = metrics;

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Risk Dashboard</h2>
      
      <div className={`p-4 rounded-lg mb-4 ${trading_allowed ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold">Trading Status</span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${trading_allowed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {trading_allowed ? 'ALLOWED' : 'BLOCKED'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">Daily PnL</div>
          <div className={`text-2xl font-bold ${daily_stats.dailyPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {daily_stats.dailyPnL.toFixed(2)}%
          </div>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">Consecutive Losses</div>
          <div className={`text-2xl font-bold ${daily_stats.consecutiveLosses >= config.max_consecutive_losses ? 'text-red-600' : 'text-gray-900'}`}>
            {daily_stats.consecutiveLosses} / {config.max_consecutive_losses}
          </div>
        </div>
      </div>

      <h3 className="text-lg font-semibold mb-3">Risk Configuration</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Risk per Trade</span>
          <span className="font-medium">{config.risk_per_trade_percent}%</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Daily Loss Limit</span>
          <span className="font-medium">{config.daily_loss_limit_percent}%</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Max Consecutive Losses</span>
          <span className="font-medium">{config.max_consecutive_losses}</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Cooldown Hours</span>
          <span className="font-medium">{config.consecutive_loss_cooldown_hours}h</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Min Signal Grade</span>
          <span className="font-medium">{config.min_signal_grade}</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Min Confidence</span>
          <span className="font-medium">{(config.min_signal_confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Max Positions/Symbol</span>
          <span className="font-medium">{config.max_positions_per_symbol}</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Max Total Positions</span>
          <span className="font-medium">{config.max_total_positions}</span>
        </div>
      </div>
    </div>
  );
}
