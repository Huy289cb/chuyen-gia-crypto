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
  method?: string;
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
  timeframe = '1h',
  method = 'ict'
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

  // Extract Kim Nghia indicators
  const kimNghiaIndicators = useMemo(() => {
    if (method !== 'kim_nghia') {
      return { fibonacci: null, orderBlocks: [], fairValueGaps: [], volume: 'normal' };
    }

    // If method is kim_nghia but analysis.indicators is missing, return default indicators
    if (!analysis?.indicators) {
      const currentPrice = data[data.length - 1]?.close || 0;
      return {
        fibonacci: {
          retracement: [
            { level: 0.382, price: currentPrice * 0.95, label: '38.2%' },
            { level: 0.5, price: currentPrice * 0.975, label: '50%' },
            { level: 0.618, price: currentPrice, label: '61.8%' }
          ],
          extension: [
            { level: 1.272, price: currentPrice * 1.05, label: '127.2%' },
            { level: 1.618, price: currentPrice * 1.08, label: '161.8%' }
          ]
        },
        orderBlocks: [],
        fairValueGaps: [],
        volume: 'normal'
      };
    }

    return {
      fibonacci: analysis.indicators.fibonacci || null,
      orderBlocks: analysis.indicators.orderBlocks || [],
      fairValueGaps: analysis.indicators.fairValueGaps || [],
      volume: analysis.indicators.volume || 'normal'
    };
  }, [analysis, method, data]);

  // Generate prediction line data like Vite implementation
  const predictionLineData = useMemo(() => {
    console.log('[PriceChart] Generating prediction line data:', { showPredictions, predictionsLength: predictions?.length || 0, dataLength: data.length });
    
    if (!showPredictions || !predictions || predictions.length === 0 || data.length === 0) {
      console.log('[PriceChart] Returning empty - missing data');
      return [];
    }

    const tfOrder = ['15m', '1h', '4h', '1d'];
    console.log('[PriceChart] Raw predictions:', JSON.stringify(predictions));
    
    // Map predictions by index if timeframe is missing (0=15m, 1=1h, 2=4h, 3=1d)
    const mappedPredictions = predictions.map((p, index) => ({
      ...p,
      timeframe: p.timeframe || tfOrder[index] || '1h',
      price_target: p.price_target || p.target || 0
    }));
    
    const validPredictions = mappedPredictions.filter(p => {
      const isValid = p && typeof p === 'object' && p.timeframe && tfOrder.includes(p.timeframe);
      if (!isValid) {
        console.log('[PriceChart] Invalid prediction:', p);
      }
      return isValid;
    });
    console.log('[PriceChart] Valid predictions:', validPredictions.length);

    if (validPredictions.length === 0) {
      console.log('[PriceChart] Returning empty - no valid predictions');
      return [];
    }

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
    console.log('[PriceChart] pred4h:', pred4h);
    console.log('[PriceChart] pred1d:', pred1d);
    
    const target4h = pred4h?.price_target && typeof pred4h.price_target === 'number' && pred4h.price_target > 0
                    ? pred4h.price_target
                    : startPrice * (1 + (pred4h?.direction === 'up' ? 0.02 : pred4h?.direction === 'down' ? -0.02 : 0));
    
    const target1d = pred1d?.price_target && typeof pred1d.price_target === 'number' && pred1d.price_target > 0
                    ? pred1d.price_target
                    : startPrice * (1 + (pred1d?.direction === 'up' ? 0.05 : pred1d?.direction === 'down' ? -0.05 : 0));

    console.log('[PriceChart] Targets:', { startPrice, target4h, target1d, candles4h, candles24h });

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

    console.log('[PriceChart] Generated lineData:', lineData.length, 'points');
    return lineData;
  }, [data, predictions, showPredictions, timeframe]);

  useEffect(() => {
    console.log('[PriceChart] useEffect running - predictionLineData:', predictionLineData?.length);
    if (!chartContainerRef.current || data.length === 0) return;
    
    // Detect dark mode
    const isDarkMode = document.documentElement.classList.contains('dark');
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: isDarkMode ? '#d1d5db' : '#374151',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: isDarkMode ? '#374151' : '#e5e7eb' },
        horzLines: { color: isDarkMode ? '#374151' : '#e5e7eb' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: isDarkMode ? '#4b5563' : '#9ca3af', style: 2 },
        horzLine: { color: isDarkMode ? '#4b5563' : '#9ca3af', style: 2 },
      },
      rightPriceScale: {
        borderColor: isDarkMode ? '#4b5563' : '#9ca3af',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: isDarkMode ? '#4b5563' : '#9ca3af',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        localization: {
          timeFormatter: (time: number) => {
            const date = new Date(time * 1000);
            // Convert to GMT+7 (Vietnam timezone)
            const gmt7Offset = 7 * 60 * 60 * 1000; // 7 hours in milliseconds
            const gmt7Date = new Date(date.getTime() + gmt7Offset);
            const hours = gmt7Date.getUTCHours().toString().padStart(2, '0');
            const minutes = gmt7Date.getUTCMinutes().toString().padStart(2, '0');
            return `${hours}:${minutes}`;
          },
          priceFormatter: (price: number) => {
            return price.toFixed(2);
          },
        },
      },
      height,
      autoSize: true,
    });

    // Candlestick series - use hardcoded colors for proper rendering
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeries.setData(data as CandlestickData[]);

    // Add prediction line series (dashed) using v5 API
    console.log('[PriceChart] Prediction line data:', predictionLineData.length, 'points');
    console.log('[PriceChart] Prediction line first:', predictionLineData[0]);
    console.log('[PriceChart] Prediction line last:', predictionLineData[predictionLineData.length - 1]);
    
    if (showPredictions && predictionLineData.length > 1) {
      console.log('[PriceChart] Adding prediction line with color:', color);
      const lineSeries = chart.addSeries(LineSeries, {
        color: color,
        lineStyle: 2, // Dashed
        lineWidth: 3,
        lastValueVisible: true,
        priceLineVisible: false,
      });
      lineSeries.setData(predictionLineData);
      console.log('[PriceChart] Prediction line added');
    } else {
      console.log('[PriceChart] NOT adding prediction line - showPredictions:', showPredictions, 'data length:', predictionLineData.length);
    }

    // Parse and add method-specific indicators
    const currentPrice = data[data.length - 1]?.close || 0;
    const getPriceRange = (coin: string, price: number): [number, number] => {
      return [price * 0.7, price * 1.3];
    };
    const validRange = getPriceRange(symbol || '', currentPrice);

    if (method === 'kim_nghia' && kimNghiaIndicators.fibonacci) {
      // Kim Nghia: Render Fibonacci levels
      console.log('[PriceChart] Rendering Kim Nghia Fibonacci levels');

      // Retracement levels (green dashed)
      kimNghiaIndicators.fibonacci.retracement?.forEach((fib, i) => {
        if (fib.price >= validRange[0] && fib.price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: fib.price,
            color: '#22c55e',
            lineWidth: 1,
            lineStyle: 2,
            title: fib.label,
          });
        }
      });

      // Extension levels (orange dashed)
      kimNghiaIndicators.fibonacci.extension?.forEach((fib, i) => {
        if (fib.price >= validRange[0] && fib.price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: fib.price,
            color: '#f97316',
            lineWidth: 1,
            lineStyle: 2,
            title: fib.label,
          });
        }
      });

      // Order Blocks as shaded zones (purple)
      kimNghiaIndicators.orderBlocks?.forEach((ob, i) => {
        if (ob.low >= validRange[0] && ob.high <= validRange[1]) {
          candleSeries.createPriceLine({
            price: ob.low,
            color: '#8b5cf6',
            lineWidth: 2,
            lineStyle: 0,
            title: i === 0 ? 'OB' : '',
          });
          candleSeries.createPriceLine({
            price: ob.high,
            color: '#8b5cf6',
            lineWidth: 2,
            lineStyle: 0,
            title: '',
          });
        }
      });
    } else if (method === 'ict' && analysis?.key_levels) {
      // ICT: Render existing indicators
      console.log('[PriceChart] ICT analysis?.key_levels:', !!analysis?.key_levels);
      console.log('[PriceChart] ICT levels:', ictLevels);
      console.log('[PriceChart] ICT validRange:', validRange);

      // Add liquidity levels (blue)
      console.log('[PriceChart] Adding liquidity levels:', ictLevels.liquidity.length);
      ictLevels.liquidity.forEach((price, i) => {
        console.log('[PriceChart] Liquidity price:', price, 'in range:', price >= validRange[0] && price <= validRange[1]);
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
  }, [data, predictionLineData, ictLevels, kimNghiaIndicators, color, analysis, showPredictions, symbol, height, method]);

  return (
    <div 
      ref={chartContainerRef} 
      className="w-full rounded-lg overflow-hidden"
      style={{ height }}
    />
  );
}
