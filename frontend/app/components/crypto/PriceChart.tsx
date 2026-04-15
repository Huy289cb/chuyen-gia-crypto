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
    
    // Debug logging
    console.log('[PriceChart] Rendering chart for', symbol);
    console.log('[PriceChart] Data points:', data.length);
    console.log('[PriceChart] First price:', data[0]?.open, 'Last price:', lastCandle.close);
    console.log('[PriceChart] Price range:', Math.min(...data.map(d => d.low)), '-', Math.max(...data.map(d => d.high)));
    console.log('[PriceChart] Predictions:', predictions);
    console.log('[PriceChart] Entry:', suggestedEntry, 'SL:', stopLoss, 'TP:', takeProfit);
    
    // Log prediction targets
    predictions?.forEach((p, i) => {
      console.log(`[PriceChart] Prediction ${i}:`, p.timeframe, p.direction, 'target:', p.price_target);
    });

    console.log('[PriceChart] Creating chart...');
    
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

    console.log('[PriceChart] Chart created, adding candlestick series...');
    
    // Candlestick series - v5 API
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderUpColor: '#16a34a',
      borderDownColor: '#dc2626',
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });
    
    console.log('[PriceChart] Candlestick series created:', !!candleSeries);
    console.log('[PriceChart] Setting data with', data.length, 'points');

    candleSeries.setData(data as CandlestickData[]);
    
    console.log('[PriceChart] Candle data set');
    
    // Force chart update
    chart.timeScale().fitContent();
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
      }
    });

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
    console.log('[PriceChart] Entry line data:', entryData);

    // TEST: Always add a test line at current price + 2%
    const testPrice = currentPrice * 1.02;
    console.log('[PriceChart] Adding TEST line at:', testPrice, 'Current close:', currentPrice);
    
    const testLine = chart.addSeries(LineSeries, {
      color: '#ef4444',  // Red
      lineWidth: 4,
      lineStyle: 2, // dashed
      title: 'TEST',
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: '#ef4444',
      priceLineWidth: 2,
    });
    
    console.log('[PriceChart] TEST series created:', !!testLine);
    
    const testData: LineData[] = [
      { time: (data[data.length - 1].time - 86400) as Time, value: testPrice },  // 1 day ago
      { time: (data[data.length - 1].time + 86400) as Time, value: testPrice },  // 1 day future
    ];
    
    console.log('[PriceChart] TEST line data:', JSON.stringify(testData));
    testLine.setData(testData);
    console.log('[PriceChart] TEST line data set, calling applyOptions');
    
    // Force update
    testLine.applyOptions({ lineWidth: 4 });

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
