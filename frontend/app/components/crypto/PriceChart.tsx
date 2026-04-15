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
    
    // Shared variables
    const lastCandle = data[data.length - 1];
    const currentPrice = lastCandle.close;
    
    // Debug logging (keep minimal)
    console.log('[PriceChart]', symbol, '- Entry:', suggestedEntry, 'SL:', stopLoss, 'TP:', takeProfit);
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(0,0,0,0.1)' }, // Debug: slight background
        textColor: '#000000',
      },
      grid: {
        vertLines: { color: '#cccccc' },
        horzLines: { color: '#cccccc' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#000000',
        visible: true,
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        borderColor: '#000000',
        timeVisible: true,
        visible: true,
      },
      height,
      autoSize: true,
    });

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: 'var(--success)',
      downColor: 'var(--danger)',
      borderUpColor: 'var(--success)',
      borderDownColor: 'var(--danger)',
      wickUpColor: 'var(--success)',
      wickDownColor: 'var(--danger)',
    });
    candleSeries.setData(data as CandlestickData[]);
    chart.timeScale().fitContent();

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

          const lineData: LineData[] = [
            { time: lastCandle.time as Time, value: pred.price_target },
            { time: (lastCandle.time + 86400) as Time, value: pred.price_target },
          ];
          lineSeries.setData(lineData);
        }
      });
    }

    // Add Suggested Entry line
    const testEntry = suggestedEntry || currentPrice * 0.98; // 2% below current if not provided
    
    console.log('[PriceChart] Adding Entry line at:', suggestedEntry, 'Using:', testEntry, 'Current:', currentPrice);
    const entryLine = chart.addSeries(LineSeries, {
      color: '#f59e0b',  // Amber
      lineWidth: 3,
      lineStyle: 1,
      title: 'Entry',
      lastValueVisible: true,
      priceLineVisible: true,
    });

    const entryData: LineData[] = [
      { time: (lastCandle.time - 86400) as Time, value: testEntry },
      { time: (lastCandle.time + 86400) as Time, value: testEntry },
    ];
    entryLine.setData(entryData);

    // Add Stop Loss line
    const testSL = stopLoss || currentPrice * 0.95; // 5% below current if not provided
    console.log('[PriceChart] Adding SL line at:', stopLoss, 'Using:', testSL);
    const slLine = chart.addSeries(LineSeries, {
      color: '#dc2626',  // Red
      lineWidth: 2,
      lineStyle: 1,
      title: 'SL',
      lastValueVisible: true,
    });

    const slData: LineData[] = [
      { time: (lastCandle.time - 86400) as Time, value: testSL },
      { time: (lastCandle.time + 86400) as Time, value: testSL },
    ];
    slLine.setData(slData);

    // Add Take Profit line
    const testTP = takeProfit || currentPrice * 1.05; // 5% above current if not provided
    console.log('[PriceChart] Adding TP line at:', takeProfit, 'Using:', testTP);
    const tpLine = chart.addSeries(LineSeries, {
      color: '#16a34a',  // Green
      lineWidth: 2,
      lineStyle: 1,
      title: 'TP',
      lastValueVisible: true,
    });

    const tpData: LineData[] = [
      { time: (lastCandle.time - 86400) as Time, value: testTP },
      { time: (lastCandle.time + 86400) as Time, value: testTP },
    ];
    tpLine.setData(tpData);

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [data, predictions, suggestedEntry, stopLoss, takeProfit, height]);

  return (
    <div 
      ref={chartContainerRef} 
      className="w-full rounded-lg overflow-hidden"
      style={{ height }}
    />
  );
}
