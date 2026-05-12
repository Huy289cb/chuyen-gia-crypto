/**
 * Execution Cost Panel
 * Displays execution cost limits and recent cost data
 */

'use client';

import { useState, useEffect } from 'react';

interface CostMetrics {
  limits: {
    max_spread_percent: number;
    max_slippage_percent: number;
    max_fee_percent: number;
    max_total_cost_percent: number;
  };
  recent_costs: any[];
  total_trades: number;
  avg_cost_percent: number;
  timestamp: string;
}

export default function ExecutionCostPanel() {
  const [metrics, setMetrics] = useState<CostMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/metrics/costs');
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching cost metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !metrics) {
    return <div className="p-6 bg-white rounded-lg shadow">Loading execution costs...</div>;
  }

  const { limits, recent_costs, total_trades, avg_cost_percent } = metrics;

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Execution Cost Panel</h2>

      <h3 className="text-lg font-semibold mb-3">Cost Limits</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">Max Spread</div>
          <div className="text-2xl font-bold text-gray-900">
            {limits.max_spread_percent}%
          </div>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">Max Slippage</div>
          <div className="text-2xl font-bold text-gray-900">
            {limits.max_slippage_percent}%
          </div>
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">Max Fee</div>
          <div className="text-2xl font-bold text-gray-900">
            {limits.max_fee_percent}%
          </div>
        </div>
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="text-sm text-blue-600">Max Total</div>
          <div className="text-2xl font-bold text-blue-900">
            {limits.max_total_cost_percent}%
          </div>
        </div>
      </div>

      <h3 className="text-lg font-semibold mb-3">Actual Costs</h3>
      {total_trades === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No trade cost data available yet
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">Total Trades</div>
            <div className="text-2xl font-bold text-gray-900">
              {total_trades}
            </div>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-600">Avg Cost</div>
            <div className={`text-2xl font-bold ${avg_cost_percent <= limits.max_total_cost_percent ? 'text-green-600' : 'text-red-600'}`}>
              {avg_cost_percent.toFixed(3)}%
            </div>
          </div>
        </div>
      )}

      <div className="text-sm text-gray-500">
        Last updated: {new Date(metrics.timestamp).toLocaleString()}
      </div>
    </div>
  );
}
