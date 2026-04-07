import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { Clock, TrendingUp, TrendingDown, Layers, Box, Droplets, Activity, MessageSquare } from 'lucide-react';

const tfLabels = {
  '15m': '15 phút',
  '1h': '1 giờ', 
  '4h': '4 giờ',
  '1d': '1 ngày'
};

const directionLabels = {
  'up': 'Tăng',
  'down': 'Giảm',
  'sideways': 'Đi ngang'
};

function formatPrice(price) {
  if (!price || isNaN(price)) return 'N/A';
  // Always display full price without abbreviations
  if (price >= 1000) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${price.toFixed(2)}`;
}

function formatNumber(num) {
  if (!num || isNaN(num)) return 'N/A';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

// DEPRECATED: This function generates fake OHLC from sparkline and should not be used
// Use real OHLC data from API instead
/*
function generateOHLCData(sparkline, timeframe = '1h') {
  if (!sparkline || sparkline.length < 2) return [];
  
  const now = new Date();
  const data = [];
  const candlesPerPoint = timeframe === '15m' ? 1 : timeframe === '1h' ? 4 : timeframe === '4h' ? 16 : 96;
  
  for (let i = 0; i < sparkline.length; i += candlesPerPoint) {
    const chunk = sparkline.slice(i, Math.min(i + candlesPerPoint, sparkline.length));
    if (chunk.length === 0) continue;
    
    const open = chunk[0];
    const close = chunk[chunk.length - 1];
    const high = Math.max(...chunk);
    const low = Math.min(...chunk);
    
    const timeOffset = Math.floor(i / candlesPerPoint);
    const time = new Date(now.getTime() - (sparkline.length / candlesPerPoint - timeOffset) * 60 * 60 * 1000);
    
    data.push({
      time: time.getTime() / 1000,
      open,
      high,
      low,
      close
    });
  }
  
  return data;
}
*/

function PredictionBadge({ prediction }) {
  if (!prediction) return null;
  
  const isUp = prediction.direction === 'up';
  const Icon = isUp ? TrendingUp : TrendingDown;
  const directionText = directionLabels[prediction.direction] || prediction.direction;
  
  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${
      isUp ? 'bg-emerald-100 text-emerald-700' : prediction.direction === 'down' ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-700'
    }`}>
      <Icon size={12} />
      <span>{tfLabels[prediction.timeframe] || prediction.timeframe}: {directionText}</span>
      {prediction.confidence > 0 && (
        <span className="opacity-75">({Math.round(prediction.confidence * 100)}%)</span>
      )}
    </div>
  );
}

// Helper to extract prices from text
function extractPrices(text, currentPrice) {
  if (!text) return [];
  const matches = text.match(/\$?[\d,]+\.?\d*[kK]?/g);
  return matches ? matches.map(m => {
    let val = m.replace(/[$,]/g, '');
    if (m.toLowerCase().includes('k')) val = parseFloat(val) * 1000;
    return parseFloat(val);
  }).filter(p => !isNaN(p) && p > 0 && p > currentPrice * 0.7 && p < currentPrice * 1.3) : [];
}

export function CoinChart({ name, symbol, data, analysis, color, predictions }) {
  const [showPredictions, setShowPredictions] = useState(true);
  const [timeframe, setTimeframe] = useState('1h');
  const [ohlcData, setOhlcData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const lineSeriesRef = useRef(null);
  
  const sparkline = data?.sparkline7d || [];
  const currentPrice = data?.price || sparkline[sparkline.length - 1] || 0;
  
  // Extract ICT levels for display
  const ictLevels = useMemo(() => {
    if (!analysis?.key_levels) return { orderBlocks: [], fvg: [], liquidity: [], bos: [], choch: [] };
    
    const { liquidity, order_blocks, fvg, bos, choch } = analysis.key_levels;
    
    return {
      orderBlocks: extractPrices(order_blocks, currentPrice),
      fvg: extractPrices(fvg, currentPrice),
      liquidity: extractPrices(liquidity, currentPrice),
      bos: extractPrices(bos, currentPrice),
      choch: extractPrices(choch, currentPrice)
    };
  }, [analysis, currentPrice]);
  
  // Fetch OHLC data from API
  useEffect(() => {
    const fetchOHLC = async () => {
      try {
        setIsLoading(true);
        const coinId = symbol.toLowerCase();
        const response = await fetch(`/api/ohlc/${coinId}?timeframe=${timeframe}&limit=100`);
        if (!response.ok) throw new Error('Failed to fetch OHLC data');
        const result = await response.json();
        if (result.success && result.data) {
          setOhlcData(result.data);
        }
      } catch (error) {
        console.warn('OHLC fetch failed:', error.message);
        // Show error state instead of using fake data
        setOhlcData([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchOHLC();
  }, [symbol, timeframe, sparkline]);
  
  // Generate prediction line data
  const predictionLineData = useMemo(() => {
    if (!showPredictions || !Array.isArray(predictions) || predictions.length === 0 || ohlcData.length === 0) {
      return [];
    }

    const tfOrder = ['15m', '1h', '4h', '1d'];

    // Safely filter and sort predictions
    const validPredictions = predictions.filter(p => {
      return p && typeof p === 'object' && p.timeframe && tfOrder.includes(p.timeframe);
    });

    if (validPredictions.length === 0) return [];

    let lineData = [];
    // Use last candle's close price for accurate starting point
    const lastCandle = ohlcData[ohlcData.length - 1];
    const startPrice = lastCandle.close;
    const baseTime = lastCandle.time;

    // Add connecting point at current time with last candle's close price
    lineData.push({ time: baseTime, value: startPrice });

    // Calculate interval in minutes based on selected timeframe
    const intervalMinutes =
      timeframe === '15m' ? 15 :
      timeframe === '1h' ? 60 :
      timeframe === '4h' ? 240 : 1440;

    // Calculate how many candles equal 4 hours and 24 hours
    const candles4h = Math.ceil(240 / intervalMinutes); // 4 hours = 240 minutes
    const candles24h = Math.ceil(1440 / intervalMinutes); // 24 hours = 1440 minutes

    // Get predictions for 4h and 1d timeframes
    const pred4h = validPredictions.find(p => p.timeframe === '4h');
    const pred1d = validPredictions.find(p => p.timeframe === '1d');

    // Determine target prices
    const target4h = pred4h?.target && typeof pred4h.target === 'number' && pred4h.target > 0 
                    ? pred4h.target 
                    : startPrice * (1 + (pred4h?.direction === 'up' ? 0.02 : pred4h?.direction === 'down' ? -0.02 : 0));
    
    const target1d = pred1d?.target && typeof pred1d.target === 'number' && pred1d.target > 0 
                    ? pred1d.target 
                    : startPrice * (1 + (pred1d?.direction === 'up' ? 0.05 : pred1d?.direction === 'down' ? -0.05 : 0));

    // Generate prediction points from current to 24h
    const totalCandles = candles24h;
    for (let i = 1; i <= totalCandles; i++) {
      const predTime = baseTime + (i * intervalMinutes * 60);
      
      let pointPrice;
      
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
        time: predTime,
        value: pointPrice
      });
    }

    return lineData;
  }, [ohlcData, predictions, showPredictions, timeframe]);
  
  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current || ohlcData.length === 0) return;
    
    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#6b7280',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#f3f4f6' },
        horzLines: { color: '#f3f4f6' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#9ca3af', style: 2 },
        horzLine: { color: '#9ca3af', style: 2 },
      },
      rightPriceScale: {
        borderColor: '#e5e7eb',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#e5e7eb',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
      },
      height: 300,
    });
    
    // Add candlestick series using v5 API
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    
    candleSeries.setData(ohlcData);
    
    // Add prediction line series (dashed) using v5 API
    const lineSeries = chart.addSeries(LineSeries, {
      color: color,
      lineStyle: 2, // Dashed
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    
    if (showPredictions && predictionLineData.length > 1) {
      lineSeries.setData(predictionLineData);
    }
    
    // Price line is not needed as the last candle shows current price
    
    // Parse and add ICT indicators
    if (analysis?.key_levels) {
      const { liquidity, order_blocks, fvg, bos, choch } = analysis.key_levels;
      
      const extractPrices = (text) => {
        if (!text) return [];
        // Extract only from descriptive text, not from JSON-like structures
        // Look for price patterns in natural language descriptions
        const matches = text.match(/\$?[\d,]+\.?\d*[kK]?/g);
        return matches ? matches.map(m => {
          let val = m.replace(/[$,]/g, '');
          if (m.toLowerCase().includes('k')) val = parseFloat(val) * 1000;
          return parseFloat(val);
        }).filter(p => !isNaN(p) && p > 0 && p < 100000) : []; // Filter out unrealistic prices
      };
      
      // Filter prices by realistic range for the coin
      const getPriceRange = (coin, currentPrice) => {
        if (coin === 'BTC') {
          return [currentPrice * 0.7, currentPrice * 1.3];
        } else if (coin === 'ETH') {
          return [currentPrice * 0.7, currentPrice * 1.3];
        }
        return [currentPrice * 0.7, currentPrice * 1.3];
      };
      
      const validRange = getPriceRange(symbol, currentPrice);
      
      // Add liquidity levels
      extractPrices(liquidity).forEach((price, i) => {
        if (price >= validRange[0] && price <= validRange[1]) {
          candleSeries.createPriceLine({
            price: price,
            color: '#3b82f6',
            lineWidth: 1,
            lineStyle: 3,
            title: i === 0 ? 'Thanh khoản' : '',
          });
        }
      });
      
      // Add order block levels
      extractPrices(order_blocks).forEach((price, i) => {
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
      
      // Add FVG levels
      extractPrices(fvg).forEach((price, i) => {
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
      
      // Add BOS levels
      extractPrices(bos).forEach((price, i) => {
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
      
      // Add CHOCH levels
      extractPrices(choch).forEach((price, i) => {
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
    
    // Store refs
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [ohlcData, predictionLineData, currentPrice, color, analysis, showPredictions]);
  
  if (!sparkline.length) return null;
  
  return (
    <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6 border border-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
               style={{ backgroundColor: color }}>
            {symbol}
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg text-gray-900">{name}</h3>
            <p className="text-xs sm:text-sm text-gray-500">
              Giá: {formatPrice(currentPrice)} 
              {data?.change24h !== undefined && (
                <span className={data.change24h >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  {' '}({data.change24h >= 0 ? '+' : ''}{data.change24h.toFixed(2)}%)
                </span>
              )}
            </p>
          </div>
        </div>
        
        {/* Bias & Action Summary */}
        {analysis && (
          <div className="text-right">
            <div className={`text-xs font-semibold ${
              analysis.bias === 'bullish' ? 'text-emerald-600' : 
              analysis.bias === 'bearish' ? 'text-rose-600' : 'text-gray-600'
            }`}>
              {analysis.bias?.toUpperCase() || 'NEUTRAL'}
            </div>
            <div className="text-xs text-gray-500">
              {analysis.action?.toUpperCase() || 'HOLD'} • {Math.round((analysis.confidence || 0) * 100)}% conf
            </div>
          </div>
        )}
      </div>
      
      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={showPredictions}
              onChange={(e) => setShowPredictions(e.target.checked)}
              className="rounded"
            />
            <span className="text-gray-600">Hiện dự báo</span>
          </label>
        </div>
        
        {/* Timeframe selector */}
        <div className="flex items-center gap-1">
          {['15m', '1h', '4h', '1d'].map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 text-xs rounded ${
                timeframe === tf 
                  ? 'bg-gray-800 text-white' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tfLabels[tf]}
            </button>
          ))}
        </div>
      </div>
      
      {/* Chart */}
      <div ref={chartContainerRef} className="w-full h-[250px] sm:h-[300px] mb-4" />
      
      {/* ICT Indicators Section */}
      {(ictLevels.orderBlocks.length > 0 || ictLevels.fvg.length > 0 || ictLevels.liquidity.length > 0 || ictLevels.bos.length > 0 || ictLevels.choch.length > 0) && (
        <div className="mb-4 p-3 bg-gray-50 rounded-xl">
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <Layers size={14} />
            Chỉ báo ICT
          </div>
          <div className="space-y-2 text-xs">
            {ictLevels.orderBlocks.length > 0 && (
              <div className="flex items-start gap-2">
                <Box size={12} className="text-violet-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-violet-700">Order Blocks:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ictLevels.orderBlocks.map((price, i) => (
                      <span key={i} className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded">
                        {formatPrice(price)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {ictLevels.fvg.length > 0 && (
              <div className="flex items-start gap-2">
                <Layers size={12} className="text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-amber-700">FVG (Fair Value Gaps):</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ictLevels.fvg.map((price, i) => (
                      <span key={i} className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded">
                        {formatPrice(price)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {ictLevels.liquidity.length > 0 && (
              <div className="flex items-start gap-2">
                <Droplets size={12} className="text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-blue-700">Liquidity:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ictLevels.liquidity.map((price, i) => (
                      <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                        {formatPrice(price)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {ictLevels.bos.length > 0 && (
              <div className="flex items-start gap-2">
                <TrendingUp size={12} className="text-red-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-red-700">BOS:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ictLevels.bos.map((price, i) => (
                      <span key={i} className="px-2 py-0.5 bg-red-100 text-red-700 rounded">
                        {formatPrice(price)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {ictLevels.choch.length > 0 && (
              <div className="flex items-start gap-2">
                <Activity size={12} className="text-cyan-500 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-cyan-700">CHOCH:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ictLevels.choch.map((price, i) => (
                      <span key={i} className="px-2 py-0.5 bg-cyan-100 text-cyan-700 rounded">
                        {formatPrice(price)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Narrative Section */}
      {analysis?.narrative && (
        <div className="mb-4 p-3 bg-blue-50 rounded-xl">
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <MessageSquare size={14} />
            Phân tích thị trường
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{analysis.narrative}</p>
        </div>
      )}
      
      {/* Predictions Section */}
      {predictions && predictions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="text-xs text-gray-500 mb-2 font-semibold">Dự báo theo khung thời gian:</div>
          <div className="flex flex-wrap gap-2">
            {predictions.map((pred, i) => (
              <PredictionBadge key={i} prediction={pred} />
            ))}
          </div>
        </div>
      )}
      
      {/* Info footer */}
      <div className="flex items-center justify-between mt-4 text-xs text-gray-500">
        <div className="flex items-center gap-2">
        </div>
        <div className="flex items-center gap-4">
          {data?.marketCap && (
            <span>Vốn hóa: {formatNumber(data.marketCap)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
