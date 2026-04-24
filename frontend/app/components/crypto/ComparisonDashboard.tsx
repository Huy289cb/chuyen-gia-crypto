'use client';

import { useEffect, useRef, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { usePaperTrading } from '@/app/hooks/usePaperTrading';
import { useTestnet } from '@/app/hooks/useTestnet';
import { cn, formatPrice } from '@/lib/utils';
import { createChart, ColorType, LineSeries, type Time, type LineData } from 'lightweight-charts';

export function ComparisonDashboard() {
  const paperTrading = usePaperTrading('kim_nghia');
  const testnet = useTestnet();

  const paperAccount = paperTrading.accounts.find(a => a.symbol === 'BTC');
  const testnetAccount = testnet.account;

  if (!paperAccount || !testnetAccount) {
    return (
      <Card className="p-6">
        <div className="text-center text-foreground-tertiary">
          <p>Loading comparison data...</p>
        </div>
      </Card>
    );
  }

  const paperWinRate = paperAccount.total_trades > 0 
    ? (paperAccount.winning_trades / paperAccount.total_trades) * 100 
    : 0;
  const testnetWinRate = testnetAccount.total_trades > 0 
    ? (testnetAccount.winning_trades / testnetAccount.total_trades) * 100 
    : 0;

  const paperReturn = ((paperAccount.available_balance - paperAccount.starting_balance) / paperAccount.starting_balance) * 100;
  const testnetReturn = ((testnetAccount.current_balance - testnetAccount.starting_balance) / testnetAccount.starting_balance) * 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Paper Trading vs Testnet</h2>
        <Badge variant="neutral">BTC - Kim Nghia Method</Badge>
      </div>

      {/* Comparison Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Paper Trading Card */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Paper Trading</h3>
            <Badge variant="success">Simulation</Badge>
          </div>

          <div className="space-y-4">
            <MetricRow 
              label="Balance" 
              value={formatPrice(paperAccount.available_balance)}
              change={paperReturn}
            />
            <MetricRow 
              label="Equity" 
              value={formatPrice(paperAccount.equity)}
            />
            <MetricRow 
              label="Win Rate" 
              value={`${paperWinRate.toFixed(1)}%`}
            />
            <MetricRow 
              label="Total Trades" 
              value={paperAccount.total_trades.toString()}
            />
            <MetricRow 
              label="Winning" 
              value={paperAccount.winning_trades.toString()}
              isPositive
            />
            <MetricRow 
              label="Losing" 
              value={paperAccount.losing_trades.toString()}
              isNegative
            />
            <MetricRow 
              label="Max Drawdown" 
              value={`-${paperAccount.max_drawdown.toFixed(1)}%`}
              isNegative
            />
          </div>
        </Card>

        {/* Testnet Card */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Binance Testnet</h3>
            <Badge variant="info">Live Test</Badge>
          </div>

          <div className="space-y-4">
            <MetricRow 
              label="Balance" 
              value={formatPrice(testnetAccount.current_balance)}
              change={testnetReturn}
            />
            <MetricRow 
              label="Equity" 
              value={formatPrice(testnetAccount.equity)}
            />
            <MetricRow 
              label="Win Rate" 
              value={`${testnetWinRate.toFixed(1)}%`}
            />
            <MetricRow 
              label="Total Trades" 
              value={testnetAccount.total_trades.toString()}
            />
            <MetricRow 
              label="Winning" 
              value={testnetAccount.winning_trades.toString()}
              isPositive
            />
            <MetricRow 
              label="Losing" 
              value={testnetAccount.losing_trades.toString()}
              isNegative
            />
            <MetricRow 
              label="Max Drawdown" 
              value={`-${testnetAccount.max_drawdown.toFixed(1)}%`}
              isNegative
            />
          </div>
        </Card>
      </div>

      {/* Performance Summary */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Performance Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ComparisonMetric
            label="Better Balance"
            winner={paperAccount.available_balance > testnetAccount.current_balance ? 'paper' : 'testnet'}
            paperValue={formatPrice(paperAccount.available_balance)}
            testnetValue={formatPrice(testnetAccount.current_balance)}
          />
          <ComparisonMetric
            label="Better Win Rate"
            winner={paperWinRate > testnetWinRate ? 'paper' : 'testnet'}
            paperValue={`${paperWinRate.toFixed(1)}%`}
            testnetValue={`${testnetWinRate.toFixed(1)}%`}
          />
          <ComparisonMetric
            label="Lower Drawdown"
            winner={paperAccount.max_drawdown < testnetAccount.max_drawdown ? 'paper' : 'testnet'}
            paperValue={`${paperAccount.max_drawdown.toFixed(1)}%`}
            testnetValue={`${testnetAccount.max_drawdown.toFixed(1)}%`}
          />
        </div>
      </Card>

      {/* Position Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Paper Trading Positions</h3>
          {paperTrading.positions.length === 0 ? (
            <p className="text-foreground-tertiary text-center py-4">No open positions</p>
          ) : (
            <div className="space-y-2">
              {paperTrading.positions.slice(0, 5).map((pos) => (
                <div key={pos.id} className="p-3 bg-surface-1 rounded-lg text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{pos.symbol}</span>
                    <Badge variant={pos.side === 'long' ? 'success' : 'danger'} className="text-xs">
                      {pos.side.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="mt-1 text-foreground-tertiary">
                    Entry: ${formatPrice(pos.entry_price)} | PnL: {pos.unrealized_pnl >= 0 ? '+' : ''}{formatPrice(pos.unrealized_pnl)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Testnet Positions</h3>
          {testnet.positions.length === 0 ? (
            <p className="text-foreground-tertiary text-center py-4">No open positions</p>
          ) : (
            <div className="space-y-2">
              {testnet.positions.slice(0, 5).map((pos) => (
                <div key={pos.position_id} className="p-3 bg-surface-1 rounded-lg text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{pos.symbol}</span>
                    <Badge variant={pos.side === 'BUY' ? 'success' : 'danger'} className="text-xs">
                      {pos.side}
                    </Badge>
                  </div>
                  <div className="mt-1 text-foreground-tertiary">
                    Entry: ${formatPrice(pos.entry_price)} | PnL: {pos.unrealized_pnl >= 0 ? '+' : ''}{formatPrice(pos.unrealized_pnl)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Equity Curve Chart */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Equity Curve Comparison</h3>
        <EquityCurveChart paperSnapshots={paperTrading.equityCurve} testnetSnapshots={testnet.equityCurve} />
      </Card>

      {/* Trade History Comparison */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Trade History</h3>
        <TradeHistoryComparison paperTrades={paperTrading.tradeHistory} testnetTrades={testnet.tradeHistory} />
      </Card>
    </div>
  );
}

function EquityCurveChart({ paperSnapshots, testnetSnapshots }: { paperSnapshots: any[]; testnetSnapshots: any[] }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Memoize chart data to prevent unnecessary recalculations
  const paperData = useMemo(() => {
    return paperSnapshots
      .map((snap) => ({
        time: Math.floor(new Date(snap.timestamp).getTime() / 1000) as Time,
        value: snap.equity,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [paperSnapshots]);

  const testnetData = useMemo(() => {
    return testnetSnapshots
      .map((snap) => ({
        time: Math.floor(new Date(snap.timestamp).getTime() / 1000) as Time,
        value: snap.equity,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
  }, [testnetSnapshots]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#848e9c',
      },
      grid: {
        vertLines: { color: '#2a2e39' },
        horzLines: { color: '#2a2e39' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 300,
    });

    // Paper trading equity line
    const paperSeries = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2,
      title: 'Paper Trading',
    });

    // Testnet equity line
    const testnetSeries = chart.addSeries(LineSeries, {
      color: '#3b82f6',
      lineWidth: 2,
      title: 'Testnet',
    });

    if (paperData.length > 0) {
      paperSeries.setData(paperData);
    }

    if (testnetData.length > 0) {
      testnetSeries.setData(testnetData);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [paperData, testnetData]);

  return (
    <div ref={chartContainerRef} style={{ height: '300px' }} />
  );
}

function TradeHistoryComparison({ paperTrades, testnetTrades }: { paperTrades: any[]; testnetTrades: any[] }) {
  if (paperTrades.length === 0 && testnetTrades.length === 0) {
    return <p className="text-foreground-tertiary text-center py-4">No trade history available</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-foreground-tertiary mb-2">Paper Trading</h4>
        {paperTrades.length === 0 ? (
          <p className="text-foreground-tertiary text-sm">No trades</p>
        ) : (
          <div className="space-y-2">
            {paperTrades.slice(0, 5).map((trade) => (
              <div key={trade.id} className="p-3 bg-surface-1 rounded-lg text-sm flex justify-between items-center">
                <div>
                  <span className="font-medium">{trade.symbol}</span>
                  <Badge variant={trade.side === 'long' ? 'success' : 'danger'} className="text-xs ml-2">
                    {trade.side.toUpperCase()}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className={cn(trade.realized_pnl >= 0 ? 'text-success' : 'text-danger')}>
                    {trade.realized_pnl >= 0 ? '+' : ''}{formatPrice(trade.realized_pnl)}
                  </div>
                  <div className="text-foreground-tertiary text-xs">
                    {trade.close_time ? new Date(trade.close_time).toLocaleDateString() : '-'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium text-foreground-tertiary mb-2">Testnet</h4>
        {testnetTrades.length === 0 ? (
          <p className="text-foreground-tertiary text-sm">No trades</p>
        ) : (
          <div className="space-y-2">
            {testnetTrades.slice(0, 5).map((trade) => (
              <div key={trade.position_id} className="p-3 bg-surface-1 rounded-lg text-sm flex justify-between items-center">
                <div>
                  <span className="font-medium">{trade.symbol}</span>
                  <Badge variant={trade.side === 'BUY' ? 'success' : 'danger'} className="text-xs ml-2">
                    {trade.side}
                  </Badge>
                </div>
                <div className="text-right">
                  <div className={cn(trade.realized_pnl >= 0 ? 'text-success' : 'text-danger')}>
                    {trade.realized_pnl >= 0 ? '+' : ''}{formatPrice(trade.realized_pnl)}
                  </div>
                  <div className="text-foreground-tertiary text-xs">
                    {trade.close_time ? new Date(trade.close_time).toLocaleDateString() : '-'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricRow({ label, value, change, isPositive, isNegative }: { 
  label: string; 
  value: string; 
  change?: number;
  isPositive?: boolean;
  isNegative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-surface-2 last:border-0">
      <span className="text-foreground-tertiary text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {change !== undefined && (
          <span className={cn('text-xs', change >= 0 ? 'text-success' : 'text-danger')}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        )}
        <span className={cn('font-medium', isPositive && 'text-success', isNegative && 'text-danger')}>
          {value}
        </span>
      </div>
    </div>
  );
}

function ComparisonMetric({ 
  label, 
  winner, 
  paperValue, 
  testnetValue 
}: { 
  label: string; 
  winner: 'paper' | 'testnet'; 
  paperValue: string; 
  testnetValue: string; 
}) {
  return (
    <div className="p-4 bg-surface-1 rounded-lg">
      <p className="text-sm text-foreground-tertiary mb-2">{label}</p>
      <div className="flex items-center justify-between">
        <div className="text-center">
          <p className="text-xs text-foreground-tertiary">Paper</p>
          <p className="font-medium">{paperValue}</p>
        </div>
        <Badge variant={winner === 'paper' ? 'success' : 'danger'} className="text-xs">
          {winner === 'paper' ? 'Paper' : 'Testnet'}
        </Badge>
        <div className="text-center">
          <p className="text-xs text-foreground-tertiary">Testnet</p>
          <p className="font-medium">{testnetValue}</p>
        </div>
      </div>
    </div>
  );
}
