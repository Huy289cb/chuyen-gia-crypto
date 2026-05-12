/**
 * No Trade Reasons
 * Displays recent no-trade decisions and their reasons
 */

'use client';

import { useState, useEffect } from 'react';

interface NoTradeDecision {
  id: number;
  symbol: string;
  timeframe: string;
  grade: string;
  confidence: number;
  regime: string;
  reason: string;
  timestamp: string;
}

interface NoTradeMetrics {
  symbol: string;
  no_trade_decisions: NoTradeDecision[];
  total_count: number;
  timestamp: string;
}

export default function NoTradeReasons() {
  const [metrics, setMetrics] = useState<NoTradeMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState('BTC');

  useEffect(() => {
    fetchMetrics();
  }, [symbol]);

  const fetchMetrics = async () => {
    try {
      const response = await fetch(`/api/metrics/no-trade?symbol=${symbol}`);
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching no-trade metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !metrics) {
    return <div className="p-6 bg-white rounded-lg shadow">Loading no-trade reasons...</div>;
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">No-Trade Reasons</h2>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="BTC">BTC</option>
          <option value="ETH">ETH</option>
        </select>
      </div>

      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="text-sm text-blue-800">
          Total no-trade decisions: <span className="font-bold">{metrics.total_count}</span>
        </div>
      </div>

      {metrics.no_trade_decisions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No no-trade decisions recorded yet
        </div>
      ) : (
        <div className="space-y-3">
          {metrics.no_trade_decisions.map((decision) => (
            <div key={decision.id} className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{decision.symbol}</span>
                  <span className="text-sm text-gray-500">{decision.timeframe}</span>
                </div>
                <span className="text-sm text-gray-500">
                  {new Date(decision.timestamp).toLocaleString()}
                </span>
              </div>
              
              <div className="mb-2">
                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                  decision.grade === 'A' ? 'bg-green-100 text-green-800' :
                  decision.grade === 'B' ? 'bg-blue-100 text-blue-800' :
                  decision.grade === 'C' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  Grade: {decision.grade}
                </span>
                <span className="ml-2 text-sm text-gray-600">
                  Confidence: {(decision.confidence * 100).toFixed(0)}%
                </span>
                <span className="ml-2 text-sm text-gray-600">
                  Regime: {decision.regime}
                </span>
              </div>
              
              <div className="text-sm text-gray-700 bg-white p-2 rounded border">
                {decision.reason}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
