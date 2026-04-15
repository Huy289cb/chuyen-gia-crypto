'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, type Time, type CandlestickData, type LineData } from 'lightweight-charts';
import type { Prediction } from '@/app/types';

interface ChartDataPoint {
  time: number;  // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PriceChartProps {
  data: ChartDataPoint[];
  predictions?: Prediction[];
  suggestedEntry?: number;
  stopLoss?: number;
  takeProfit?: number;
  height?: number;
  symbol?: string;
}

export function PriceChart({ 
  data, 
  predictions, 
  suggestedEntry,
  stopLoss,
  takeProfit,
  height = 300,
  symbol
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;
    
    // Debug logging
    console.log('[PriceChart] Rendering chart for', symbol);
    console.log('[PriceChart] Data points:', data.length);
    console.log('[PriceChart] Predictions:', predictions);
    console.log('[PriceChart] Entry/SL/TP:', { suggestedEntry, stopLoss, takeProfit });

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'var(--text-secondary)',
      },
      grid: {
        vertLines: { color: 'var(--border-subtle)' },
        horzLines: { color: 'var(--border-subtle)' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'var(--border-default)',
      },
      timeScale: {
        borderColor: 'var(--border-default)',
        timeVisible: true,
      },
      height,
      autoSize: true,
    });

    // Candlestick series - v5 API
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'var(--success)',
      downColor: 'var(--danger)',
      borderUpColor: 'var(--success)',
      borderDownColor: 'var(--danger)',
      wickUpColor: 'var(--success)',
      wickDownColor: 'var(--danger)',
    });

    candleSeries.setData(data as CandlestickData[]);

    // Add prediction lines if available
    if (predictions && predictions.length > 0) {
      predictions.forEach((pred) => {
        if (pred.price_target) {
          const lineSeries = chart.addSeries(LineSeries, {
            color: pred.direction === 'up' ? 'var(--success)' : 'var(--danger)',
            lineWidth: 2,
            lineStyle: 2, // dashed
            title: `${pred.timeframe} Target`,
          });

          const lastCandle = data[data.length - 1];
          const lineData: LineData[] = [
            { time: lastCandle.time as Time, value: pred.price_target },
            { time: (lastCandle.time + 86400) as Time, value: pred.price_target },
          ];
          lineSeries.setData(lineData);
        }
      });
    }

    // Add Suggested Entry line
    if (suggestedEntry) {
      const entryLine = chart.addSeries(LineSeries, {
        color: 'var(--accent-primary)',
        lineWidth: 2,
        lineStyle: 1,
        title: 'Entry',
      });

      const lastCandle = data[data.length - 1];
      const entryData: LineData[] = [
        { time: lastCandle.time as Time, value: suggestedEntry },
        { time: (lastCandle.time + 86400) as Time, value: suggestedEntry },
      ];
      entryLine.setData(entryData);
    }

    // Add Stop Loss line
    if (stopLoss) {
      const slLine = chart.addSeries(LineSeries, {
        color: 'var(--danger)',
        lineWidth: 2,
        lineStyle: 1,
        title: 'SL',
      });

      const lastCandle = data[data.length - 1];
      const slData: LineData[] = [
        { time: lastCandle.time as Time, value: stopLoss },
        { time: (lastCandle.time + 86400) as Time, value: stopLoss },
      ];
      slLine.setData(slData);
    }

    // Add Take Profit line
    if (takeProfit) {
      const tpLine = chart.addSeries(LineSeries, {
        color: 'var(--success)',
        lineWidth: 2,
        lineStyle: 1,
        title: 'TP',
      });

      const lastCandle = data[data.length - 1];
      const tpData: LineData[] = [
        { time: lastCandle.time as Time, value: takeProfit },
        { time: (lastCandle.time + 86400) as Time, value: takeProfit },
      ];
      tpLine.setData(tpData);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [data, predictions, suggestedEntry, stopLoss, takeProfit, height]);

  // Debug render
  return (
    <div className="relative">
      {/* Debug Panel */}
      <div className="absolute top-2 left-2 z-10 bg-surface-1/90 p-2 rounded text-xs font-mono">
        <div>Symbol: {symbol}</div>
        <div>Data points: {data.length}</div>
        <div>Predictions: {predictions?.length || 0}</div>
        <div>Entry: {suggestedEntry?.toFixed(2) || 'N/A'}</div>
        <div>SL: {stopLoss?.toFixed(2) || 'N/A'}</div>
        <div>TP: {takeProfit?.toFixed(2) || 'N/A'}</div>
        <div className="mt-1 text-warning">
          Targets: {predictions?.filter(p => p.price_target).length || 0}
        </div>
      </div>
      
      <div 
        ref={chartContainerRef} 
        className="w-full rounded-lg overflow-hidden"
        style={{ height }}
      />
    </div>
  );
}
