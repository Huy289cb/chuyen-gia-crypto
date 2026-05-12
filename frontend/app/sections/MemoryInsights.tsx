/**
 * Memory Insights
 * Displays trade decision history, outcomes, and reflections
 */

'use client';

import { useState, useEffect } from 'react';

interface TradeDecision {
  id: number;
  symbol: string;
  timeframe: string;
  playbook_key: string;
  grade: string;
  confidence: number;
  regime: string;
  decision: string;
  reason: string;
  timestamp: string;
  trade_outcome?: {
    outcome: string;
    realized_pnl: number;
    realized_rr: number;
  };
}

export default function MemoryInsights() {
  const [decisions, setDecisions] = useState<TradeDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState('BTC');

  useEffect(() => {
    fetchDecisions();
  }, [symbol]);

  const fetchDecisions = async () => {
    try {
      // This will query the trade_decisions table when implemented
      // For now, return empty array
      setDecisions([]);
    } catch (error) {
      console.error('Error fetching memory insights:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6 bg-white rounded-lg shadow">Loading memory insights...</div>;
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Memory Insights</h2>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="BTC">BTC</option>
          <option value="ETH">ETH</option>
        </select>
      </div>

      {decisions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No trade decisions recorded yet
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map((decision) => (
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
                  decision.decision === 'trade' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {decision.decision.toUpperCase()}
                </span>
                <span className="ml-2 text-sm text-gray-600">
                  {decision.playbook_key}
                </span>
              </div>
              
              {decision.trade_outcome && (
                <div className="mb-2 p-2 bg-white rounded border">
                  <div className="text-sm">
                    <span className={`font-medium ${decision.trade_outcome.outcome === 'win' ? 'text-green-600' : 'text-red-600'}`}>
                      {decision.trade_outcome.outcome.toUpperCase()}
                    </span>
                    <span className="ml-2 text-gray-600">
                      PnL: {decision.trade_outcome.realized_pnl.toFixed(2)}%
                    </span>
                    <span className="ml-2 text-gray-600">
                      R:R: {decision.trade_outcome.realized_rr.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              
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
