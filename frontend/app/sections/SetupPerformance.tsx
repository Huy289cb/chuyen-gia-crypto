/**
 * Setup Performance
 * Displays playbook statistics and performance metrics
 */

'use client';

import { useState, useEffect } from 'react';

interface PlaybookStats {
  playbook_key: string;
  total_trades: number;
  win_rate: number;
  avg_rr: number;
  avg_pnl: number;
  total_pnl: number;
  last_updated: string;
}

interface PlaybookMetrics {
  symbol: string;
  playbooks: PlaybookStats[];
  timestamp: string;
}

export default function SetupPerformance() {
  const [metrics, setMetrics] = useState<PlaybookMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [symbol, setSymbol] = useState('BTC');

  useEffect(() => {
    fetchMetrics();
  }, [symbol]);

  const fetchMetrics = async () => {
    try {
      const response = await fetch(`/api/metrics/playbooks?symbol=${symbol}`);
      const data = await response.json();
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching playbook metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !metrics) {
    return <div className="p-6 bg-white rounded-lg shadow">Loading setup performance...</div>;
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Setup Performance</h2>
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="BTC">BTC</option>
          <option value="ETH">ETH</option>
        </select>
      </div>

      {metrics.playbooks.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No playbook data available yet
        </div>
      ) : (
        <div className="space-y-4">
          {metrics.playbooks.map((playbook) => (
            <div key={playbook.playbook_key} className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">{playbook.playbook_key}</h3>
                <span className="text-sm text-gray-500">
                  {playbook.total_trades} trades
                </span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Win Rate</div>
                  <div className={`text-xl font-bold ${playbook.win_rate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                    {playbook.win_rate.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Avg R:R</div>
                  <div className="text-xl font-bold text-gray-900">
                    {playbook.avg_rr.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Avg PnL</div>
                  <div className={`text-xl font-bold ${playbook.avg_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {playbook.avg_pnl.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Total PnL</div>
                  <div className={`text-xl font-bold ${playbook.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {playbook.total_pnl.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-sm text-gray-500">
        Last updated: {new Date(metrics.timestamp).toLocaleString()}
      </div>
    </div>
  );
}
