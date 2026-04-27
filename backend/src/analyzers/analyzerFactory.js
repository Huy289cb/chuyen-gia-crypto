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

      // If no Groq API key, return error immediately
      if (!client) {
        console.log(`[${methodConfig.name}] No API key - analysis unavailable`);
        return {
          btc: {
            bias: 'neutral',
            action: 'hold',
            confidence: 0,
            narrative: 'AI analysis unavailable - no API key',
            current_price: priceData.btc?.price || 0,
            suggested_entry: null,
            suggested_stop_loss: null,
            suggested_take_profit: null,
            expected_rr: null
          },
          eth: {
            bias: 'neutral',
            action: 'hold',
            confidence: 0,
            narrative: 'AI analysis unavailable - no API key',
            current_price: priceData.eth?.price || 0,
            suggested_entry: null,
            suggested_stop_loss: null,
            suggested_take_profit: null,
            expected_rr: null
          },
          error: 'No API key',
          raw_question: null,
          raw_answer: null
        };
      }

      console.log(`[${methodConfig.name}] Starting analysis...`);

      // Build user prompt with historical context
      const userPrompt = await buildUserPrompt(priceData, db, methodConfig.methodId);

      // Capture full request (system prompt + user prompt)
      const fullRequest = `SYSTEM PROMPT:\n${methodConfig.systemPrompt}\n\nUSER PROMPT:\n${userPrompt}`;

      try {
        const response = await client.analyze({
          systemPrompt: methodConfig.systemPrompt,
          userPrompt,
          temperature: 0.6,
          maxRetries: 2
        });

        // Validate AI response for consistency
        try {
          const { validateAIResponse } = await import('../groq-client.js');
          validateAIResponse(response, 'btc');
          validateAIResponse(response, 'eth');
        } catch (validationError) {
          console.error(`[${methodConfig.name}] AI response validation failed:`, validationError.message);
          // Return neutral response on validation failure
          return {
            btc: {
              bias: 'neutral',
              action: 'hold',
              confidence: 0,
              narrative: `AI response validation failed: ${validationError.message}`,
              current_price: priceData.btc?.price || 0,
              suggested_entry: null,
              suggested_stop_loss: null,
              suggested_take_profit: null,
              expected_rr: null
            },
            eth: {
              bias: 'neutral',
              action: 'hold',
              confidence: 0,
              narrative: `AI response validation failed: ${validationError.message}`,
              current_price: priceData.eth?.price || 0,
              suggested_entry: null,
              suggested_stop_loss: null,
              suggested_take_profit: null,
              expected_rr: null
            },
            error: validationError.message,
            raw_question: fullRequest,
            raw_answer: JSON.stringify(response, null, 2)
          };
        }

        // Capture raw response as JSON string
        const rawResponse = JSON.stringify(response, null, 2);

        // Log raw AI response for debugging
        console.log(`[${methodConfig.name}] RAW AI RESPONSE:`);
        console.log(rawResponse);

        // Format response with method_id tagging
        const formatted = await formatAnalysisResponse(response, priceData, methodConfig.methodId, db);
        console.log(`[${methodConfig.name}] Analysis complete`);
        console.log(`  BTC: ${formatted.btc.action} | bias: ${formatted.btc.bias} | confidence: ${(formatted.btc.confidence * 100).toFixed(0)}%`);
        console.log(`  BTC narrative: ${formatted.btc.narrative}`);
        console.log(`  ETH: ${formatted.eth.action} | bias: ${formatted.eth.bias} | confidence: ${(formatted.eth.confidence * 100).toFixed(0)}%`);
        console.log(`  ETH narrative: ${formatted.eth.narrative}`);

        // Return formatted analysis with raw question and answer
        return {
          ...formatted,
          raw_question: fullRequest,
          raw_answer: rawResponse
        };
      } catch (error) {
        console.error(`[${methodConfig.name}] Error:`, error.message);
        // Return simple error message instead of fallback analysis
        return {
          btc: {
            bias: 'neutral',
            action: 'hold',
            confidence: 0,
            narrative: 'AI analysis failed - no data available',
            current_price: priceData.btc?.price || 0,
            suggested_entry: null,
            suggested_stop_loss: null,
            suggested_take_profit: null,
            expected_rr: null
          },
          eth: {
            bias: 'neutral',
            action: 'hold',
            confidence: 0,
            narrative: 'AI analysis failed - no data available',
            current_price: priceData.eth?.price || 0,
            suggested_entry: null,
            suggested_stop_loss: null,
            suggested_take_profit: null,
            expected_rr: null
          },
          error: error.message,
          raw_question: fullRequest,
          raw_answer: null
        };
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
export async function buildUserPrompt(priceData, db, methodId) {
  let historicalContext = '';
  let openPositionsContext = '';
  let pendingOrdersContext = '';
  
  if (db) {
    try {
      const { getRecentAnalysisWithPredictions, getPositions, getPendingOrders } = await import('../db/database.js');
      
      // Get predictions from last 24 hours, filtered by method_id (BTC only)
      const btcHistoryResult = await getRecentAnalysisWithPredictions(db, 'BTC', 20, methodId);
      const btcHistory = btcHistoryResult.data || [];
      
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

      // Skip prediction history for Kim Nghia method (it doesn't use timeframe predictions)
      if (methodId === 'kim_nghia') {
        console.log(`[AnalyzerFactory][${methodId}] Skipping prediction history for Kim Nghia method`);
      } else if (btcContext) {
        historicalContext = `\n\nPREDICTION HISTORY (24H):\n${btcContext}\n\nReview past accuracy. If recent predictions were incorrect, be more conservative. If accurate, maintain confidence.`;
        console.log(`[AnalyzerFactory][${methodId}] Historical prediction context included`);
      } else {
        console.log(`[AnalyzerFactory][${methodId}] No historical predictions available in last 24h`);
      }
      
      // Fetch open positions for AI decision making, filtered by method_id (BTC only)
      try {
        const btcOpenPositions = await getPositions(db, { symbol: 'BTC', status: 'open', method_id: methodId });
        
        const formatOpenPositions = (positions, coinName) => {
          if (!positions || positions.length === 0) return '';
          
          const lines = [`OPEN ${coinName} POSITIONS:`];
          positions.forEach(pos => {
            const currentPrice = priceData[coinName.toLowerCase()]?.price || pos.entry_price;
            const pnl = (currentPrice - pos.entry_price) * (pos.side === 'long' ? 1 : -1) * pos.size_qty;
            const pnlPercent = (pnl / pos.size_usd) * 100;
            const riskPercent = ((pos.entry_price - pos.stop_loss) / pos.entry_price) * 100;
            const timeInPosition = pos.entry_time ? Math.floor((Date.now() - new Date(pos.entry_time).getTime()) / (1000 * 60 * 60)) : 0;
            
            lines.push(
              `- Position ID: ${pos.position_id}`,
              `  ${pos.side.toUpperCase()}: Entry $${pos.entry_price.toLocaleString()}, Current $${currentPrice.toLocaleString()}`,
              `  SL $${pos.stop_loss.toLocaleString()}, TP $${pos.take_profit.toLocaleString()}`,
              `  PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%), Risk: ${riskPercent.toFixed(2)}%, Size: $${pos.size_usd.toLocaleString()}`,
              `  Time in position: ${timeInPosition}h`
            );
          });
          return lines.join('\n');
        };
        
        const btcPositions = formatOpenPositions(btcOpenPositions, 'BTC');
        
        if (btcPositions) {
          openPositionsContext = `\n\n${btcPositions}\n\nFor each open position, provide a decision in position_decisions array with action (hold/close_early/close_partial/move_sl/reverse), confidence (0-1), and reason. Include position_id from above.\n\nCRITICAL REMINDER: Position decisions MUST align with your overall bias assessment. If you determine bias=bearish, do NOT close existing short positions unless structure has fundamentally changed (bias reversal or structure break). If bias=bullish, do NOT close existing long positions unless structure has fundamentally changed.`;
          console.log(`[AnalyzerFactory][${methodId}] Open positions context included:`, btcOpenPositions.length, 'positions');
        } else {
          console.log(`[AnalyzerFactory][${methodId}] No open positions to analyze`);
        }
      } catch (error) {
        console.log(`[AnalyzerFactory][${methodId}] Failed to fetch open positions:`, error.message);
      }
      
      // Fetch pending orders for AI decision making, filtered by method_id (BTC only)
      try {
        const btcPendingOrders = await getPendingOrders(db, { symbol: 'BTC', status: 'pending', method_id: methodId });
        
        const formatPendingOrders = (orders, coinName) => {
          if (!orders || orders.length === 0) return '';
          
          const lines = [`PENDING ${coinName} LIMIT ORDERS:`];
          orders.forEach(order => {
            const currentPrice = priceData[coinName.toLowerCase()]?.price || order.entry_price;
            const priceDiff = ((currentPrice - order.entry_price) / order.entry_price) * 100;
            const timeWaiting = order.created_at ? Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60)) : 0;
            
            lines.push(
              `- Order ID: ${order.order_id}`,
              `  ${order.side.toUpperCase()}: Entry $${order.entry_price.toLocaleString()}, Current $${currentPrice.toLocaleString()}`,
              `  SL $${order.stop_loss.toLocaleString()}, TP $${order.take_profit.toLocaleString()}, Size $${order.size_usd.toLocaleString()}`,
              `  Price Diff: ${priceDiff.toFixed(2)}%, Waiting: ${timeWaiting}h, Risk: ${order.risk_percent.toFixed(2)}%, R:R ${order.expected_rr.toFixed(1)}`
            );
          });
          return lines.join('\n');
        };
        
        const btcPending = formatPendingOrders(btcPendingOrders, 'BTC');
        
        if (btcPending) {
          pendingOrdersContext = `\n\n${btcPending}\n\nFor each pending order, provide a decision in pending_order_decisions array with action (hold/cancel/modify), confidence (0-1), and reason. Include order_id from above.`;
          console.log(`[AnalyzerFactory][${methodId}] Pending orders context included:`, btcPendingOrders.length, 'orders');
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

  const methodConfig = getMethodConfig(methodId);
  const methodName = methodConfig.name;

  // Fetch OHLC candle data for Kim Nghia method (BTC only, 30 candles)
  let ohlcContext = '';
  if (methodId === 'kim_nghia' && db) {
    try {
      const { getOHLCCandles } = await import('../db/database.js');
      console.log(`[AnalyzerFactory][${methodId}] Fetching OHLC data for analysis...`);
      const btcOhlc = await getOHLCCandles(db, 'BTC', 30, '15m');
      
      if (btcOhlc && btcOhlc.length > 0) {
        const btcRecent = btcOhlc.map(c => 
          `[${new Date(c.timestamp).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})}] O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} V:${c.volume || 'N/A'}`
        ).join('\n');
        ohlcContext += `\nBTC OHLC CANDLES (15m, 30 candles):\n${btcRecent}\n`;
      }
      
      console.log(`[AnalyzerFactory][${methodId}] OHLC data fetched - BTC: ${btcOhlc?.length || 0} candles (reduced to 30 for rate limit)`);
    } catch (error) {
      console.log(`[AnalyzerFactory][${methodId}] Failed to fetch OHLC data:`, error.message);
    }
  }

  // Build prompt with conditional instructions
  let prompt = `Analyze BTC using ${methodName} methodology (BTC-only mode - ETH temporarily paused).

BTC DATA:
- Current Price: $${priceData.btc.price.toLocaleString()}
- 24h Change: ${priceData.btc.change24h?.toFixed(2)}%
- 7d Change: ${priceData.btc.change7d?.toFixed(2)}%
- Timeframe Changes: 15m=${btcChanges['15m']?.toFixed(3)}%, 1h=${btcChanges['1h']?.toFixed(3)}%, 4h=${btcChanges['4h']?.toFixed(3)}%, 1d=${btcChanges['1d']?.toFixed(3)}%
- Recent Prices (last points): ${JSON.stringify(priceData.btc.prices1d?.slice(-6) || [])}
${ohlcContext}
${historicalContext}
${openPositionsContext}
${pendingOrdersContext}`;

  // Only add decision instructions if there are positions or orders to analyze
  if (openPositionsContext || pendingOrdersContext) {
    prompt += `\n\nIMPORTANT: Return position_decisions and pending_order_decisions arrays as specified in the system prompt. Each decision must include the position_id or order_id from the context above.`;
  }

  return prompt;
}

/**
 * Format analysis response with method_id tagging and validation
 * @param {Object} rawResponse - Raw response from analyzer
 * @param {Object} priceData - Price data
 * @param {string} methodId - Method ID
 * @param {Object} db - Database connection
 * @returns {Promise<Object>} Formatted response
 */
async function formatAnalysisResponse(rawResponse, priceData, methodId, db) {
  // Fetch open positions for bias consistency validation
  let openPositions = [];
  if (db) {
    try {
      const { getPositions } = await import('../db/database.js');
      const btcOpenPositions = await getPositions(db, { symbol: 'BTC', status: 'open', method_id: methodId });
      openPositions = btcOpenPositions || [];
      console.log(`[AnalyzerFactory] Fetched ${openPositions.length} open positions for bias validation`);
    } catch (error) {
      console.log(`[AnalyzerFactory] Failed to fetch open positions for validation:`, error.message);
    }
  }

  // Calculate Fibonacci for Kim Nghia method before formatting
  let kimNghiaFibonacci = null;
  if (methodId === 'kim_nghia' && db) {
    try {
      const { getFibonacciFromOHLC } = await import('../utils/fibonacci.js');
      const { getOHLCCandles } = await import('../db/database.js');
      console.log('[AnalyzerFactory] Fetching OHLC data for Fibonacci calculation...');
      const btcOhlc = await getOHLCCandles(db, 'BTC', 30, '15m');
      const ethOhlc = await getOHLCCandles(db, 'ETH', 30, '15m');
      console.log('[AnalyzerFactory] OHLC data fetched - BTC:', btcOhlc?.length, 'candles, ETH:', ethOhlc?.length, 'candles');

      // Check if OHLC data is available before calculating Fibonacci
      if (btcOhlc && btcOhlc.length > 0 && ethOhlc && ethOhlc.length > 0) {
        const btcBias = rawResponse?.btc?.bias === 'bullish' ? 'up' : 'down';
        const ethBias = rawResponse?.eth?.bias === 'bullish' ? 'up' : 'down';
        console.log('[AnalyzerFactory] Calculating Fibonacci - BTC bias:', btcBias, 'ETH bias:', ethBias);
        kimNghiaFibonacci = {
          btc: getFibonacciFromOHLC(btcOhlc, btcBias, 20),
          eth: getFibonacciFromOHLC(ethOhlc, ethBias, 20)
        };
        console.log('[AnalyzerFactory] Fibonacci calculation successful');
      } else {
        console.warn('[AnalyzerFactory] No OHLC data available for Fibonacci calculation');
        kimNghiaFibonacci = null;
      }
    } catch (error) {
      console.error('[AnalyzerFactory] Error calculating Fibonacci:', error.message);
      console.error('[AnalyzerFactory] Error stack:', error.stack);
      kimNghiaFibonacci = null;
    }
  }

  // Validate position_decisions array with bias consistency check
  const validatePositionDecisions = (decisions, bias, openPositions) => {
    if (!decisions || !Array.isArray(decisions)) return null;
    
    const validActions = ['hold', 'close_early', 'close_partial', 'move_sl', 'reverse'];
    
    // Create position lookup map
    const positionMap = new Map();
    if (openPositions && Array.isArray(openPositions)) {
      openPositions.forEach(pos => {
        positionMap.set(pos.position_id, pos);
      });
    }
    
    return decisions
      .filter(dec => {
        // Required fields
        if (!dec.position_id || !dec.action || !dec.reason) {
          console.log(`[AnalyzerFactory] Invalid position decision: missing required fields`);
          return false;
        }
        
        // Validate action
        if (!validActions.includes(dec.action)) {
          console.log(`[AnalyzerFactory] Invalid position action: ${dec.action}`);
          return false;
        }
        
        // Validate confidence
        const confidence = parseFloat(dec.confidence);
        if (isNaN(confidence) || confidence < 0 || confidence > 1) {
          console.log(`[AnalyzerFactory] Invalid position confidence: ${dec.confidence}`);
          return false;
        }
        
        // Validate optional fields based on action
        if (dec.action === 'close_partial' && (!dec.close_percent || dec.close_percent <= 0 || dec.close_percent > 1)) {
          console.log(`[AnalyzerFactory] Invalid close_percent for close_partial: ${dec.close_percent}`);
          return false;
        }
        
        if (dec.action === 'move_sl' && !dec.new_sl) {
          console.log(`[AnalyzerFactory] Missing new_sl for move_sl action`);
          return false;
        }
        
        // CRITICAL: Check bias consistency for close_early and reverse actions
        if (dec.action === 'close_early' || dec.action === 'reverse') {
          const position = positionMap.get(dec.position_id);
          if (position) {
            // If bias aligns with position, reject close_early/reverse
            if (bias === 'bullish' && position.side === 'long') {
              console.log(`[AnalyzerFactory] REJECTED ${dec.action}: bias=bullish, position=long. Action changed to hold.`);
              dec.action = 'hold';
              dec.reason = 'Auto-corrected: Bias aligns with position direction. Holding position.';
            }
            if (bias === 'bearish' && position.side === 'short') {
              console.log(`[AnalyzerFactory] REJECTED ${dec.action}: bias=bearish, position=short. Action changed to hold.`);
              dec.action = 'hold';
              dec.reason = 'Auto-corrected: Bias aligns with position direction. Holding position.';
            }
          }
        }
        
        return true;
      })
      .map(dec => ({
        ...dec,
        confidence: parseFloat(dec.confidence),
        close_percent: dec.close_percent ? parseFloat(dec.close_percent) : null,
        new_sl: dec.new_sl ? parseFloat(dec.new_sl) : null,
        new_tp: dec.new_tp ? parseFloat(dec.new_tp) : null
      }));
  };
  
  // Validate pending_order_decisions array
  const validatePendingOrderDecisions = (decisions) => {
    if (!decisions || !Array.isArray(decisions)) return null;
    
    const validActions = ['hold', 'cancel', 'modify'];
    
    return decisions
      .filter(dec => {
        // Required fields
        if (!dec.order_id || !dec.action || !dec.reason) {
          console.log(`[AnalyzerFactory] Invalid pending order decision: missing required fields`);
          return false;
        }
        
        // Validate action
        if (!validActions.includes(dec.action)) {
          console.log(`[AnalyzerFactory] Invalid pending order action: ${dec.action}`);
          return false;
        }
        
        // Validate confidence
        const confidence = parseFloat(dec.confidence);
        if (isNaN(confidence) || confidence < 0 || confidence > 1) {
          console.log(`[AnalyzerFactory] Invalid pending order confidence: ${dec.confidence}`);
          return false;
        }
        
        // Validate optional fields based on action
        if (dec.action === 'modify' && !dec.new_entry && !dec.new_sl && !dec.new_tp) {
          console.log(`[AnalyzerFactory] Modify action requires at least one of new_entry, new_sl, or new_tp`);
          return false;
        }
        
        return true;
      })
      .map(dec => ({
        ...dec,
        confidence: parseFloat(dec.confidence),
        new_entry: dec.new_entry ? parseFloat(dec.new_entry) : null,
        new_sl: dec.new_sl ? parseFloat(dec.new_sl) : null,
        new_tp: dec.new_tp ? parseFloat(dec.new_tp) : null
      }));
  };

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
      
      let p = parseFloat(price);
      
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
      
      // Additional validation: ensure stop loss is at least 0.5% away from entry
      if (type === 'stop_loss' && suggestedEntry) {
        const distance = Math.abs(p - suggestedEntry);
        const minDistance = suggestedEntry * 0.005; // 0.5% minimum (matches prompt)
        if (distance < minDistance) {
          console.log(`[AnalyzerFactory][${methodId}] Stop loss ${p} too close to entry ${suggestedEntry} (distance ${distance.toFixed(2)} < minimum ${minDistance.toFixed(2)}), adjusting to minimum`);
          // Adjust SL to minimum distance on the correct side
          if (bias === 'bullish') {
            // For long: SL should be below entry
            p = suggestedEntry - minDistance;
          } else if (bias === 'bearish') {
            // For short: SL should be above entry
            p = suggestedEntry + minDistance;
          } else {
            // Unknown bias, reject
            console.log(`[AnalyzerFactory][${methodId}] Unknown bias ${bias}, rejecting SL`);
            return null;
          }
          console.log(`[AnalyzerFactory][${methodId}] Adjusted stop loss to ${p} (distance ${minDistance.toFixed(2)})`);
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
    const bias = ['bullish', 'bearish', 'neutral'].includes(coinData?.bias) 
      ? coinData.bias 
      : 'neutral';

    return {
      bias: bias,
      action: ['buy', 'sell', 'hold'].includes(coinData?.action)
        ? coinData.action
        : 'hold',
      confidence: Math.max(0, Math.min(1, parseFloat(coinData?.confidence) || 0.4)),
      narrative: (coinData?.narrative || 'No narrative provided').substring(0, 350),
      scoring_detail: coinData?.scoring_detail || null,
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
      // Position and order management decisions with validation
      position_decisions: validatePositionDecisions(coinData?.position_decisions, bias, openPositions),
      pending_order_decisions: validatePendingOrderDecisions(coinData?.pending_order_decisions),
      alternative_scenario: coinData?.alternative_scenario ? {
        ...coinData.alternative_scenario,
        new_entry: validatePriceLevel(coinData.alternative_scenario.new_entry, currentPrice, 'entry', bias),
        new_sl: validatePriceLevel(coinData.alternative_scenario.new_sl, currentPrice, 'stop_loss', bias, validatePriceLevel(coinData.alternative_scenario.new_entry, currentPrice, 'entry', bias)),
        new_tp: validatePriceLevel(coinData.alternative_scenario.new_tp, currentPrice, 'take_profit', bias)
      } : null,
      breakout_retest: coinData?.breakout_retest || null,
      volume_analysis: coinData?.volume_analysis || null,
      structure: coinData?.structure || null,
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
        volume: coinData?.indicators?.volume || coinData?.volume_analysis || 'normal'
      } : null
    };
  };

  return {
    btc: formatCoin(rawResponse?.btc, priceData.btc?.price || 0, 'btc'),
    eth: formatCoin(rawResponse?.eth, priceData.eth?.price || 0, 'eth'),
    comparison: rawResponse?.comparison || '',
    marketSentiment: rawResponse?.marketSentiment || 'neutral',
  };
}

