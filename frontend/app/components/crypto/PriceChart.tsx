'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, type Time, type CandlestickData, type LineData } from 'lightweight-charts';
import type { Prediction, Analysis } from '@/app/types';

interface ChartDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface PriceChartProps {
  data: ChartDataPoint[];
  predictions?: Prediction[];
  analysis?: Analysis;
  color?: string;
  height?: number;
  symbol?: string;
  showPredictions?: boolean;
  timeframe?: string;
}

// Helper to extract prices from text
function extractPrices(text: string | undefined, currentPrice: number): number[] {
  if (!text) return [];
  const matches = text.match(/\$?[\d,]+\.?\d*[kK]?/g);
  return matches ? matches.map(m => {
    let valStr = m.replace(/[$,]/g, '');
    let num = parseFloat(valStr);
    if (m.toLowerCase().includes('k')) num = num * 1000;
    return num;
  }).filter(p => !isNaN(p) && p > 0 && p > currentPrice * 0.7 && p < currentPrice * 1.3) : [];
}

export function PriceChart({ 
  data, 
  predictions, 
  analysis,
  color = '#f7931a',
  height = 300,
  symbol,
  showPredictions = true,
  timeframe = '1h'
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Extract ICT levels
  const ictLevels = useMemo(() => {
    if (!analysis?.key_levels) return { orderBlocks: [], fvg: [], liquidity: [], bos: [], choch: [] };
    
    const { liquidity, order_blocks, fvg, bos, choch } = analysis.key_levels;
    const currentPrice = data[data.length - 1]?.close || 0;
    
    return {
      orderBlocks: extractPrices(order_blocks, currentPrice),
      fvg: extractPrices(fvg, currentPrice),
      liquidity: extractPrices(liquidity, currentPrice),
      bos: extractPrices(bos, currentPrice),
      choch: extractPrices(choch, currentPrice)
    };
  }, [analysis, data]);

  // Generate prediction line data like Vite implementation
  const predictionLineData = useMemo(() => {
    if (!showPredictions || !predictions || predictions.length === 0 || data.length === 0) {
      return [];
    }

    const tfOrder = ['15m', '1h', '4h', '1d'];
    const validPredictions = predictions.filter(p => {
      return p && typeof p === 'object' && p.timeframe && tfOrder.includes(p.timeframe);
    });

    if (validPredictions.length === 0) return [];

    const lineData: LineData[] = [];
    const lastCandle = data[data.length - 1];
    const startPrice = lastCandle.close;
    const baseTime = lastCandle.time;

    // Add connecting point at current time with last candle's close price
    lineData.push({ time: baseTime as Time, value: startPrice });

    // Calculate interval in minutes based on selected timeframe
    const intervalMinutes =
      timeframe === '15m' ? 15 :
      timeframe === '1h' ? 60 :
      timeframe === '4h' ? 240 : 1440;

    // Calculate how many candles equal 4 hours and 24 hours
    const candles4h = Math.ceil(240 / intervalMinutes);
    const candles24h = Math.ceil(1440 / intervalMinutes);

    // Get predictions for 4h and 1d timeframes
    const pred4h = validPredictions.find(p => p.timeframe === '4h');
    const pred1d = validPredictions.find(p => p.timeframe === '1d');

    // Determine target prices
    const target4h = pred4h?.price_target && typeof pred4h.price_target === 'number' && pred4h.price_target > 0
                    ? pred4h.price_target
                    : startPrice * (1 + (pred4h?.direction === 'up' ? 0.02 : pred4h?.direction === 'down' ? -0.02 : 0));
    
    const target1d = pred1d?.price_target && typeof pred1d.price_target === 'number' && pred1d.price_target > 0
                    ? pred1d.price_target
                    : startPrice * (1 + (pred1d?.direction === 'up' ? 0.05 : pred1d?.direction === 'down' ? -0.05 : 0));

    // Generate prediction points from current to 24h
    const totalCandles = candles24h;
    for (let i = 1; i <= totalCandles; i++) {
      const predTime = baseTime + (i * intervalMinutes * 60);
      
      let pointPrice: number;
      
      if (i <= candles4h) {
        // Points 1 to candles4h: Interpolate from start to 4h target
        const progress = i / candles4h;
        pointPrice = startPrice + (target4h - startPrice) * progress;
      } else {
        // Points candles4h+1 to totalCandles: Interpolate from 4h target to 1d target
        const progress = (i - candles4h) / (totalCandles - candles4h);
        pointPrice = target4h + (target1d - target4h) * progress;
      }

      lineData.push({
        time: predTime as Time,
        value: pointPrice
      });
    }

    return lineData;
  }, [data, predictions, showPredictions, timeframe]);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'var(--text-secondary)',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'var(--border-subtle)' },
        horzLines: { color: 'var(--border-subtle)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'var(--border-default)', style: 2 },
        horzLine: { color: 'var(--border-default)', style: 2 },
      },
      rightPriceScale: {
        borderColor: 'var(--border-default)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'var(--border-default)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
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

    // Add prediction line series (dashed) using v5 API
    if (showPredictions && predictionLineData.length > 1) {
      const lineSeries = chart.addSeries(LineSeries, {
        color: color,
        lineStyle: 2, // Dashed
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      lineSeries.setData(predictionLineData);
    }

    // Parse and add ICT indicators using createPriceLine
    if (analysis?.key_levels) {
      const currentPrice = data[data.length - 1]?.close || 0;
      
      const getPriceRange = (coin: string, price: number): [number, number] => {
        return [price * 0.7, price * 1.3];
      };
      
      const validRange = getPriceRange(symbol || '', currentPrice);
      
      // Add liquidity levels (blue)
      ictLevels.liquidity.forEach((price, i) => {
        if (price >= validRange[0] && price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: price,
            color: '#3b82f6',
            lineWidth: 1,
            lineStyle: 3,
            title: i === 0 ? 'Liquidity' : '',
          });
        }
      });
      
      // Add order block levels (purple)
      ictLevels.orderBlocks.forEach((price, i) => {
        if (price >= validRange[0] && price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: price,
            color: '#8b5cf6',
            lineWidth: 1,
            lineStyle: 3,
            title: i === 0 ? 'OB' : '',
          });
        }
      });
      
      // Add FVG levels (amber)
      ictLevels.fvg.forEach((price, i) => {
        if (price >= validRange[0] && price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: price,
            color: '#f59e0b',
            lineWidth: 1,
            lineStyle: 3,
            title: i === 0 ? 'FVG' : '',
          });
        }
      });
      
      // Add BOS levels (red)
      ictLevels.bos.forEach((price, i) => {
        if (price >= validRange[0] && price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: price,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: 1,
            title: i === 0 ? 'BOS' : '',
          });
        }
      });
      
      // Add CHOCH levels (cyan)
      ictLevels.choch.forEach((price, i) => {
        if (price >= validRange[0] && price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: price,
            color: '#06b6d4',
            lineWidth: 2,
            lineStyle: 1,
            title: i === 0 ? 'CHOCH' : '',
          });
        }
      });
    }
    
    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    
    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, predictionLineData, ictLevels, color, analysis, showPredictions, symbol, height]);

  return (
    <div 
      ref={chartContainerRef} 
      className="w-full rounded-lg overflow-hidden"
      style={{ height }}
    />
  );
}
