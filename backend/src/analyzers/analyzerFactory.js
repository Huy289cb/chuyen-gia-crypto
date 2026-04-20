// Analyzer Factory for multi-method paper trading system
// Creates method-specific analyzers with their own prompts and configurations

import { createGroqClient } from '../groq-client.js';
import { getMethodConfig } from '../config/methods.js';

/**
 * Create an analyzer for a specific method
 * @param {Object} methodConfig - Method configuration from METHODS object
 * @returns {Object} Analyzer object with analyze method
 */
export function createAnalyzer(methodConfig) {
  return {
    methodId: methodConfig.methodId,
    name: methodConfig.name,
    
    /**
     * Analyze price data using method-specific analyzer
     * @param {Object} priceData - Price data from fetchPrices
     * @param {Object} db - Optional database connection for historical context
     * @returns {Promise<Object>} Analysis result
     */
    analyze: async (priceData, db = null) => {
      const client = createGroqClient(process.env.GROQ_API_KEY);
      
      // If no Groq API key, use fallback immediately
      if (!client) {
        console.log(`[${methodConfig.name}] No API key, using fallback analysis`);
        return generateFallbackAnalysis(priceData, methodConfig.methodId);
      }

      console.log(`[${methodConfig.name}] Starting analysis...`);

      // Build user prompt with historical context
      const userPrompt = await buildUserPrompt(priceData, db, methodConfig.methodId);

      try {
        const response = await client.analyze({
          systemPrompt: methodConfig.systemPrompt,
          userPrompt,
          temperature: 0.3,
          maxRetries: 2
        });

        // Format response with method_id tagging
        const formatted = await formatAnalysisResponse(response, priceData, methodConfig.methodId);
        console.log(`[${methodConfig.name}] Analysis complete`);
        console.log(`  BTC: ${formatted.btc.action} | bias: ${formatted.btc.bias} | confidence: ${(formatted.btc.confidence * 100).toFixed(0)}%`);
        console.log(`  ETH: ${formatted.eth.action} | bias: ${formatted.eth.bias} | confidence: ${(formatted.eth.confidence * 100).toFixed(0)}%`);

        return formatted;
      } catch (error) {
        console.error(`[${methodConfig.name}] Error:`, error.message);
        console.log(`[${methodConfig.name}] Falling back to rule-based analysis`);
        return generateFallbackAnalysis(priceData, methodConfig.methodId);
      }
    }
  };
}

/**
 * Build user prompt with historical context, open positions, and pending orders
 * @param {Object} priceData - Price data
 * @param {Object} db - Database connection
 * @param {string} methodId - Method ID for filtering
 * @returns {Promise<string>} User prompt string
 */
async function buildUserPrompt(priceData, db, methodId) {
  let historicalContext = '';
  let openPositionsContext = '';
  let pendingOrdersContext = '';
  
  if (db) {
    try {
      const { getRecentAnalysisWithPredictions, getPositions, getPendingOrders } = await import('../db/database.js');
      
      // Get predictions from last 24 hours, filtered by method_id
      const btcHistory = await getRecentAnalysisWithPredictions(db, 'BTC', 20, methodId);
      const ethHistory = await getRecentAnalysisWithPredictions(db, 'ETH', 20, methodId);
      
      // Filter to last 24 hours and only 4h/1d timeframes
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      
      const formatPredictionHistory = (history, coinName) => {
        if (!history || history.length === 0) return '';
        
        const filtered = history
          .filter(h => new Date(h.timestamp) >= twentyFourHoursAgo)
          .slice(0, 10); // Limit to 10 most recent
        
        if (filtered.length === 0) return '';
        
        let lines = [];
        filtered.forEach(h => {
          const predictions = h.predictions || [];
          predictions.forEach(p => {
            // Only include 4h and 1d timeframes
            if (p.timeframe === '4h' || p.timeframe === '1d') {
              const hoursAgo = Math.round((new Date() - new Date(h.timestamp)) / (1000 * 60 * 60));
              const status = p.is_correct === true ? '✓ CORRECT' : p.is_correct === false ? '✗ INCORRECT' : 'PENDING';
              const actualPrice = p.actual ? `$${p.actual.toLocaleString()}` : 'PENDING';
              lines.push(
                `${coinName} ${p.timeframe}: [${hoursAgo}h ago] predicted ${p.direction.toUpperCase()} to $${p.target?.toLocaleString() || 'N/A'} (conf: ${Math.round((p.confidence || 0) * 100)}%) → actual: ${actualPrice} ${status}`
              );
            }
          });
        });
        
        return lines.join('\n');
      };
      
      const btcContext = formatPredictionHistory(btcHistory, 'BTC');
      const ethContext = formatPredictionHistory(ethHistory, 'ETH');

      // Skip prediction history for Kim Nghia method (it doesn't use timeframe predictions)
      if (methodId === 'kim_nghia') {
        console.log(`[AnalyzerFactory][${methodId}] Skipping prediction history for Kim Nghia method`);
      } else if (btcContext || ethContext) {
        historicalContext = `\n\nPREDICTION HISTORY (24H):\n${btcContext}\n${ethContext}\n\nReview past accuracy. If recent predictions were incorrect, be more conservative. If accurate, maintain confidence.`;
        console.log(`[AnalyzerFactory][${methodId}] Historical prediction context included`);
      } else {
        console.log(`[AnalyzerFactory][${methodId}] No historical predictions available in last 24h`);
      }
      
      // Fetch open positions for AI decision making, filtered by method_id
      try {
        const btcOpenPositions = await getPositions(db, { symbol: 'BTC', status: 'open', method_id: methodId });
        const ethOpenPositions = await getPositions(db, { symbol: 'ETH', status: 'open', method_id: methodId });
        
        const formatOpenPositions = (positions, coinName) => {
          if (!positions || positions.length === 0) return '';
          
          const lines = [`OPEN ${coinName} POSITIONS:`];
          positions.forEach(pos => {
            const pnl = ((priceData[coinName.toLowerCase()]?.price || pos.entry_price) - pos.entry_price) * (pos.side === 'long' ? 1 : -1);
            const pnlPercent = (pnl / (pos.entry_price * pos.size_qty)) * 100;
            const riskPercent = ((pos.entry_price - pos.stop_loss) / pos.entry_price) * 100;
            
            lines.push(
              `- ${pos.side.toUpperCase()}: Entry $${pos.entry_price.toLocaleString()}, Current $${(priceData[coinName.toLowerCase()]?.price || pos.entry_price).toLocaleString()}, SL $${pos.stop_loss.toLocaleString()}, TP $${pos.take_profit.toLocaleString()}`,
              `  PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%), Risk: ${riskPercent.toFixed(2)}%, Size: ${pos.size_qty} ${coinName}`
            );
          });
          return lines.join('\n');
        };
        
        const btcPositions = formatOpenPositions(btcOpenPositions, 'BTC');
        const ethPositions = formatOpenPositions(ethOpenPositions, 'ETH');
        
        if (btcPositions || ethPositions) {
          openPositionsContext = `\n\n${btcPositions}\n${ethPositions}\n\nANALYZE OPEN POSITIONS: If confidence > 80%, recommend whether to CLOSE any positions early. Consider current market conditions vs original entry logic. Provide specific recommendations with confidence levels.`;
          console.log(`[AnalyzerFactory][${methodId}] Open positions context included:`, btcOpenPositions.length + ethOpenPositions.length, 'positions');
        } else {
          console.log(`[AnalyzerFactory][${methodId}] No open positions to analyze`);
        }
      } catch (error) {
        console.log(`[AnalyzerFactory][${methodId}] Failed to fetch open positions:`, error.message);
      }
      
      // Fetch pending orders for AI decision making, filtered by method_id
      try {
        const btcPendingOrders = await getPendingOrders(db, { symbol: 'BTC', status: 'pending', method_id: methodId });
        const ethPendingOrders = await getPendingOrders(db, { symbol: 'ETH', status: 'pending', method_id: methodId });
        
        const formatPendingOrders = (orders, coinName) => {
          if (!orders || orders.length === 0) return '';
          
          const lines = [`PENDING ${coinName} LIMIT ORDERS:`];
          orders.forEach(order => {
            const currentPrice = priceData[coinName.toLowerCase()]?.price || order.entry_price;
            const priceDiff = ((currentPrice - order.entry_price) / order.entry_price) * 100;
            const timeWaiting = order.created_at ? Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60)) : 0;
            
            lines.push(
              `- ${order.side.toUpperCase()}: Entry $${order.entry_price.toLocaleString()}, Current $${(priceData[coinName.toLowerCase()]?.price || order.entry_price).toLocaleString()}`,
              `  SL $${order.stop_loss.toLocaleString()}, TP $${order.take_profit.toLocaleString()}, Size $${order.size_usd.toLocaleString()}`,
              `  Price Diff: ${priceDiff.toFixed(2)}%, Waiting: ${timeWaiting}h, Risk: ${order.risk_percent.toFixed(2)}%, R:R ${order.expected_rr.toFixed(1)}`
            );
          });
          return lines.join('\n');
        };
        
        const btcPending = formatPendingOrders(btcPendingOrders, 'BTC');
        const ethPending = formatPendingOrders(ethPendingOrders, 'ETH');
        
        if (btcPending || ethPending) {
          pendingOrdersContext = `\n\n${btcPending}\n${ethPending}\n\nPENDING ORDER ANALYSIS: If confidence > 80%, recommend whether to KEEP or CANCEL any limit orders. Consider if market conditions have changed since order creation, if price is moving away from entry, or if setup is no longer valid.`;
          console.log(`[AnalyzerFactory][${methodId}] Pending orders context included:`, btcPendingOrders.length + ethPendingOrders.length, 'orders');
        } else {
          console.log(`[AnalyzerFactory][${methodId}] No pending orders to analyze`);
        }
      } catch (error) {
        console.log(`[AnalyzerFactory][${methodId}] Failed to fetch pending orders:`, error.message);
      }
    } catch (error) {
      console.log(`[AnalyzerFactory][${methodId}] Failed to fetch historical context:`, error.message);
    }
  } else {
    console.log(`[AnalyzerFactory][${methodId}] Database not available, skipping historical context, open positions and pending orders`);
  }

  // Calculate actual changes for each timeframe to help Groq
  const calcChange = (arr) => {
    if (!arr || arr.length < 2) return 0;
    const first = arr[0];
    const last = arr[arr.length - 1];
    return ((last - first) / first) * 100;
  };

  const btcChanges = {
    '15m': calcChange(priceData.btc.sparkline7d?.slice(-2)),
    '1h': calcChange(priceData.btc.prices1h),
    '4h': calcChange(priceData.btc.prices4h),
    '1d': calcChange(priceData.btc.prices1d)
  };
  const ethChanges = {
    '15m': calcChange(priceData.eth.sparkline7d?.slice(-2)),
    '1h': calcChange(priceData.eth.prices1h),
    '4h': calcChange(priceData.eth.prices4h),
    '1d': calcChange(priceData.eth.prices1d)
  };

  const methodConfig = getMethodConfig(methodId);
  const methodName = methodConfig.name;

  return `Analyze BTC and ETH using ${methodName} methodology.

BTC DATA:
- Current Price: $${priceData.btc.price.toLocaleString()}
- 24h Change: ${priceData.btc.change24h?.toFixed(2)}%
- 7d Change: ${priceData.btc.change7d?.toFixed(2)}%
- Timeframe Changes: 15m=${btcChanges['15m']?.toFixed(3)}%, 1h=${btcChanges['1h']?.toFixed(3)}%, 4h=${btcChanges['4h']?.toFixed(3)}%, 1d=${btcChanges['1d']?.toFixed(3)}%
- Recent Prices (last points): ${JSON.stringify(priceData.btc.prices1d?.slice(-6) || [])}

ETH DATA:
- Current Price: $${priceData.eth.price.toLocaleString()}
- 24h Change: ${priceData.eth.change24h?.toFixed(2)}%
- 7d Change: ${priceData.eth.change7d?.toFixed(2)}%
- Timeframe Changes: 15m=${ethChanges['15m']?.toFixed(3)}%, 1h=${ethChanges['1h']?.toFixed(3)}%, 4h=${ethChanges['4h']?.toFixed(3)}%, 1d=${ethChanges['1d']?.toFixed(3)}%
- Recent Prices (last points): ${JSON.stringify(priceData.eth.prices1d?.slice(-6) || [])}
${historicalContext}
${openPositionsContext}
${pendingOrdersContext}
Apply ${methodName} methodology:
1. Check multi-timeframe structure
2. Identify liquidity levels
3. Look for BOS (Break of Structure) or CHOCH (Change of Character) patterns
4. Note any FVGs in recent price action
5. Build narrative: Where is price? Where is liquidity? Where is it going?
6. Give directional bias and action
7. Market Sentiment: Determine overall market sentiment (bullish/bearish/neutral/mixed) based on both coins
8. Comparison: Briefly compare BTC vs ETH performance and structure
9. Position Management: If open positions exist, evaluate if they should be closed early based on current analysis
10. Pending Order Management: If limit orders exist, evaluate if they should be kept or cancelled based on current market conditions

IMPORTANT: Identify specific price levels for:
- BOS: Price where structure broke (new highs/lows)
- CHOCH: Price where character changed from trend to range or reverse

Return ONLY valid JSON following the system format.`;
}

/**
 * Format analysis response with method_id tagging and validation
 * @param {Object} rawResponse - Raw response from analyzer
 * @param {Object} priceData - Price data
 * @param {string} methodId - Method ID
 * @returns {Promise<Object>} Formatted response
 */
async function formatAnalysisResponse(rawResponse, priceData, methodId) {
  // Calculate Fibonacci for Kim Nghia method before formatting
  let kimNghiaFibonacci = null;
  if (methodId === 'kim_nghia') {
    try {
      const { getFibonacciFromOHLC } = await import('../utils/fibonacci.js');
      const { getOHLCData } = await import('../db/database.js');
      const btcOhlc = await getOHLCData(priceData.btc?.db, 'BTC', '15m', 50);
      const ethOhlc = await getOHLCData(priceData.eth?.db, 'ETH', '15m', 50);
      const btcBias = rawResponse?.btc?.bias === 'bullish' ? 'up' : 'down';
      const ethBias = rawResponse?.eth?.bias === 'bullish' ? 'up' : 'down';
      kimNghiaFibonacci = {
        btc: getFibonacciFromOHLC(btcOhlc, btcBias, 20),
        eth: getFibonacciFromOHLC(ethOhlc, ethBias, 20)
      };
    } catch (error) {
      console.error('[AnalyzerFactory] Error calculating Fibonacci:', error.message);
      kimNghiaFibonacci = null;
    }
  }

  const formatCoin = (coinData, currentPrice, coin) => {
    // Check if predictions have valid targets
    const hasValidPredictions = coinData?.predictions && 
      Object.keys(coinData.predictions).length > 0 &&
      Object.values(coinData.predictions).some(p => p && p.target);
    
    // Validate and fix prediction targets
    const validatePredictionTarget = (pred, currentPrice) => {
      if (!pred || !pred.target) return pred;
      
      const target = parseFloat(pred.target);
      if (isNaN(target)) return pred;
      
      // Ensure target is reasonable (within 50% of current price)
      const maxTarget = currentPrice * 1.5;
      const minTarget = currentPrice * 0.5;
      
      if (target > maxTarget || target < minTarget) {
        console.log(`[AnalyzerFactory][${methodId}] Fixing unrealistic target: ${target} -> ${currentPrice * 1.1}`);
        return {
          ...pred,
          target: currentPrice * 1.1 // Default to 10% move
        };
      }
      
      return pred;
    };

    // Validate trading suggestion fields for limit orders
    const validatePriceLevel = (price, currentPrice, type, bias = null, suggestedEntry = null) => {
      if (!price || isNaN(price)) return null;
      
      const p = parseFloat(price);
      
      // For entry prices: validate within reasonable range based on current price
      if (type === 'entry') {
        // Validate entry is within 10% of current price (realistic limit order range)
        const maxPrice = currentPrice * 1.10;
        const minPrice = currentPrice * 0.90;
        
        if (p > maxPrice || p < minPrice) {
          console.log(`[AnalyzerFactory][${methodId}] Entry ${p} outside 10% range of ${currentPrice}, rejecting`);
          return null;
        }
        
        // Validate direction alignment for limit orders
        if (bias === 'bullish' && p > currentPrice * 1.05) {
          // Long entry too far above current price
          console.log(`[AnalyzerFactory][${methodId}] Long entry ${p} too far above current ${currentPrice}, rejecting`);
          return null;
        }
        if (bias === 'bearish' && p < currentPrice * 0.95) {
          // Short entry too far below current price
          console.log(`[AnalyzerFactory][${methodId}] Short entry ${p} too far below current ${currentPrice}, rejecting`);
          return null;
        }
        
        return p; // Return validated suggested entry
      }
      
      // For SL/TP: validate within reasonable range (50%-150% of current price)
      const maxPrice = currentPrice * 1.5;
      const minPrice = currentPrice * 0.5;
      
      if (p > maxPrice || p < minPrice) {
        console.log(`[AnalyzerFactory][${methodId}] Fixing unrealistic ${type}: ${p} (outside valid range of ${currentPrice})`);
        return null;
      }
      
      // Additional validation: ensure stop loss is at least 1% away from entry
      if (type === 'stop_loss' && suggestedEntry) {
        const distance = Math.abs(p - suggestedEntry);
        const minDistance = suggestedEntry * 0.01; // 1% minimum
        if (distance < minDistance) {
          console.log(`[AnalyzerFactory][${methodId}] Stop loss ${p} too close to entry ${suggestedEntry} (distance ${distance.toFixed(2)} < minimum ${minDistance.toFixed(2)}), rejecting`);
          return null;
        }

        // Validate SL is on correct side of entry based on bias
        if (bias === 'bullish' && p >= suggestedEntry) {
          // For long: SL must be below entry
          console.log(`[AnalyzerFactory][${methodId}] Long stop loss ${p} must be below entry ${suggestedEntry}, rejecting`);
          return null;
        }
        if (bias === 'bearish' && p <= suggestedEntry) {
          // For short: SL must be above entry
          console.log(`[AnalyzerFactory][${methodId}] Short stop loss ${p} must be above entry ${suggestedEntry}, rejecting`);
          return null;
        }
      }

      // Validate TP is on correct side of entry based on bias
      if (type === 'take_profit' && suggestedEntry && bias) {
        if (bias === 'bullish' && p <= suggestedEntry) {
          // For long: TP must be above entry
          console.log(`[AnalyzerFactory][${methodId}] Long take profit ${p} must be above entry ${suggestedEntry}, rejecting`);
          return null;
        }
        if (bias === 'bearish' && p >= suggestedEntry) {
          // For short: TP must be below entry
          console.log(`[AnalyzerFactory][${methodId}] Short take profit ${p} must be below entry ${suggestedEntry}, rejecting`);
          return null;
        }
      }

      return p;
    };
    
    // Determine bias first for direction-aware validation
    const bias = hasValidPredictions && ['bullish', 'bearish', 'neutral'].includes(coinData?.bias) 
      ? coinData.bias 
      : 'neutral';
    
    return {
      bias: bias,
      action: hasValidPredictions && ['buy', 'sell', 'hold'].includes(coinData?.action) 
        ? coinData.action 
        : 'hold',
      confidence: hasValidPredictions ? Math.max(0, Math.min(1, parseFloat(coinData?.confidence) || 0.4)) : 0.3,
      narrative: hasValidPredictions 
        ? (coinData?.narrative || 'No narrative provided').substring(0, 350)
        : 'Không có dự báo cụ thể - cần phân tích thêm dữ liệu',
      timeframes: {
        '15m': coinData?.timeframes?.['15m'] || 'neutral',
        '1h': coinData?.timeframes?.['1h'] || 'neutral',
        '4h': coinData?.timeframes?.['4h'] || 'neutral',
        '1d': coinData?.timeframes?.['1d'] || 'neutral'
      },
      key_levels: {
        liquidity: coinData?.key_levels?.liquidity || 'not identified',
        order_blocks: coinData?.key_levels?.order_blocks || 'not identified',
        fvg: coinData?.key_levels?.fvg || 'not identified',
        bos: coinData?.key_levels?.bos || 'not identified',
        choch: coinData?.key_levels?.choch || 'not identified'
      },
      predictions: {
        '15m': validatePredictionTarget(coinData?.predictions?.['15m'], currentPrice),
        '1h': validatePredictionTarget(coinData?.predictions?.['1h'], currentPrice),
        '4h': validatePredictionTarget(coinData?.predictions?.['4h'], currentPrice),
        '1d': validatePredictionTarget(coinData?.predictions?.['1d'], currentPrice)
      },
      risk: coinData?.risk || 'Crypto markets are volatile - trade carefully',
      // New trading suggestion fields with bias-aware validation
      current_price: currentPrice,
      suggested_entry: validatePriceLevel(coinData?.suggested_entry, currentPrice, 'entry', bias),
      suggested_stop_loss: validatePriceLevel(coinData?.suggested_stop_loss, currentPrice, 'stop_loss', bias, validatePriceLevel(coinData?.suggested_entry, currentPrice, 'entry', bias)),
      suggested_take_profit: validatePriceLevel(coinData?.suggested_take_profit, currentPrice, 'take_profit', bias),
      expected_rr: coinData?.expected_rr && !isNaN(coinData.expected_rr) ? Math.max(0, parseFloat(coinData.expected_rr)) : null,
      invalidation_level: validatePriceLevel(coinData?.invalidation_level, currentPrice, 'invalidation', bias),
      reason_summary: coinData?.reason_summary ? coinData.reason_summary.substring(0, 200) : null,
      // Position and order management decisions
      position_decisions: coinData?.position_decisions || null,
      alternative_scenario: coinData?.alternative_scenario ? {
        ...coinData.alternative_scenario,
        new_entry: validatePriceLevel(coinData.alternative_scenario.new_entry, currentPrice, 'entry', bias),
        new_sl: validatePriceLevel(coinData.alternative_scenario.new_sl, currentPrice, 'stop_loss', bias, validatePriceLevel(coinData.alternative_scenario.new_entry, currentPrice, 'entry', bias)),
        new_tp: validatePriceLevel(coinData.alternative_scenario.new_tp, currentPrice, 'take_profit', bias)
      } : null,
      breakout_retest: coinData?.breakout_retest || null,
      // Method-specific indicators for chart visualization
      indicators: methodId === 'kim_nghia' ? {
        fibonacci: kimNghiaFibonacci?.[coin] || {
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
        orderBlocks: coinData?.indicators?.orderBlocks || [],
        fairValueGaps: coinData?.indicators?.fairValueGaps || [],
        volume: coinData?.indicators?.volume || 'normal'
      } : null
    };
  };

  return {
    btc: formatCoin(rawResponse?.btc, priceData.btc?.price || 0, 'btc'),
    eth: formatCoin(rawResponse?.eth, priceData.eth?.price || 0, 'eth'),
    comparison: rawResponse?.comparison || '',
    marketSentiment: rawResponse?.marketSentiment || 'neutral',
    disclaimer: rawResponse?.disclaimer || 'This is NOT financial advice. Crypto is high risk. Only invest what you can afford to lose completely.'
  };
}

/**
 * Generate fallback analysis when Groq fails
 * @param {Object} priceData - Price data
 * @param {string} methodId - Method ID
 * @returns {Object} Fallback analysis
 */
function generateFallbackAnalysis(priceData, methodId) {
  console.log(`[AnalyzerFactory][${methodId}] Generating fallback analysis`);

  const calcChange = (arr) => {
    if (!arr || arr.length < 2) return 0;
    const first = arr[0];
    const last = arr[arr.length - 1];
    return ((last - first) / first) * 100;
  };

  const analyzeCoin = (coinData) => {
    const change15m = calcChange(coinData.sparkline7d?.slice(-2));
    const change1h = calcChange(coinData.prices1h);
    const change4h = calcChange(coinData.prices4h);
    const change1d = calcChange(coinData.prices1d);
    const change24h = coinData.change24h || 0;

    // Determine bias based on 4h trend
    let bias = 'neutral';
    let action = 'hold';
    let confidence = 0.4;

    if (change4h > 1) {
      bias = 'bullish';
      action = change1h > 0 ? 'buy' : 'hold';
      confidence = 0.55;
    } else if (change4h < -1) {
      bias = 'bearish';
      action = change1h < 0 ? 'sell' : 'hold';
      confidence = 0.55;
    }

    const trendText = change24h >= 0 ? 'tăng' : 'giảm';
    const biasText = bias === 'bullish' ? 'tăng' : bias === 'bearish' ? 'giảm' : 'đi ngang';
    const resistance = (coinData.price * 1.02).toFixed(0);
    const support = (coinData.price * 0.98).toFixed(0);
    const narrative = `Giá ${trendText} ${Math.abs(change24h).toFixed(2)}% trong 24h. Khung 4h: ${change4h.toFixed(2)}%. Xu hướng ${biasText}, chờ breakout. Kháng cự gần nhất: $${resistance}, Hỗ trợ: $${support}.`;

    return {
      bias,
      action,
      confidence,
      narrative: narrative.substring(0, 350),
      timeframes: {
        '15m': change15m > 0.2 ? 'tăng' : change15m < -0.2 ? 'giảm' : 'đi ngang',
        '1h': change1h > 0.5 ? 'tăng' : change1h < -0.5 ? 'giảm' : 'đi ngang',
        '4h': change4h > 1 ? 'tăng' : change4h < -1 ? 'giảm' : 'đi ngang',
        '1d': change1d > 2 ? 'tăng' : change1d < -2 ? 'giảm' : 'đi ngang'
      },
      key_levels: {
        liquidity: 'Chưa xác định - cần phân tích chi tiết',
        order_blocks: 'Chưa xác định',
        fvg: 'Chưa xác định',
        bos: 'Chưa xác định - cần quan sát breakout',
        choch: 'Chưa xác định - cần quan sát sự thay đổi xu hướng'
      },
      predictions: {
        '15m': { direction: bias === 'bullish' ? 'up' : bias === 'bearish' ? 'down' : 'sideways', target: null, confidence: confidence * 0.8 },
        '1h': { direction: bias === 'bullish' ? 'up' : bias === 'bearish' ? 'down' : 'sideways', target: null, confidence: confidence * 0.9 },
        '4h': { direction: bias === 'bullish' ? 'up' : bias === 'bearish' ? 'down' : 'sideways', target: null, confidence: confidence },
        '1d': { direction: bias === 'bullish' ? 'up' : bias === 'bearish' ? 'down' : 'sideways', target: null, confidence: confidence * 0.7 }
      },
      risk: 'Phân tích dự phòng - độ chính xác hạn chế. Luôn quản lý rủi ro.'
    };
  };

  return {
    btc: analyzeCoin(priceData.btc),
    eth: analyzeCoin(priceData.eth),
    comparison: 'Fallback analysis requires full data',
    marketSentiment: 'neutral',
    disclaimer: 'FALLBACK ANALYSIS: This is NOT financial advice. Crypto is extremely volatile. Never invest more than you can afford to lose.'
  };
}
