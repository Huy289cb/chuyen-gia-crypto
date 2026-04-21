// Groq Analyzer Module - ICT Smart Money Concepts
// Multi-timeframe analysis using Groq LLM API
// Now uses analyzer factory for multi-method support

import { createGroqClient } from './groq-client.js';
import { createAnalyzer } from './analyzers/analyzerFactory.js';
import { getMethodConfig } from './config/methods.js';

// Lazy load groqClient to ensure env vars are loaded
let groqClient = null;
const getGroqClient = () => {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = createGroqClient(process.env.GROQ_API_KEY);
  }
  return groqClient;
};

/**
 * Analyze price data using Groq API with multi-timeframe approach (ICT method)
 * This is a wrapper for backward compatibility, defaults to ICT method
 * @param {Object} priceData - Price data from fetchPrices
 * @param {Object} db - Optional database connection for historical context
 * @param {string} methodId - Method ID (defaults to 'ict')
 * @returns {Promise<Object>} Analysis result
 */
export async function analyzeWithGroq(priceData, db = null, methodId = 'ict') {
  try {
    // Get method configuration
    const methodConfig = getMethodConfig(methodId);
    
    // Create analyzer for the specified method
    const analyzer = createAnalyzer(methodConfig);
    
    // Run analysis
    return await analyzer.analyze(priceData, db);
  } catch (error) {
    console.error('[GroqAnalyzer] Error:', error.message);
    console.log('[GroqAnalyzer] Falling back to rule-based analysis');
    return generateFallbackAnalysis(priceData, methodId);
  }
}

/**
 * Format and validate analysis response for ICT format
 */
function formatAnalysisResponse(rawResponse, priceData) {
  const defaultCoinAnalysis = {
    bias: 'neutral',
    action: 'hold',
    confidence: 0.4,
    narrative: 'Analysis error - using default',
    timeframes: {
      '1h': 'neutral',
      '4h': 'neutral',
      '1d': 'neutral'
    },
    key_levels: {
      liquidity: 'not identified',
      order_blocks: 'not identified',
      fvg: 'not identified'
    },
    predictions: {
      '15m': { direction: 'sideways', target: null, confidence: 0.3 },
      '1h': { direction: 'sideways', target: null, confidence: 0.3 },
      '4h': { direction: 'sideways', target: null, confidence: 0.3 },
      '1d': { direction: 'sideways', target: null, confidence: 0.3 }
    },
    risk: 'High uncertainty - exercise caution'
  };

  const formatCoin = (coinData, currentPrice) => {
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
        console.log(`[GroqAnalyzer] Fixing unrealistic target: ${target} -> ${currentPrice * 1.1}`);
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
          console.log(`[GroqAnalyzer] Entry ${p} outside 10% range of ${currentPrice}, rejecting`);
          return null;
        }
        
        // Validate direction alignment for limit orders
        if (bias === 'bullish' && p > currentPrice * 1.05) {
          // Long entry too far above current price
          console.log(`[GroqAnalyzer] Long entry ${p} too far above current ${currentPrice}, rejecting`);
          return null;
        }
        if (bias === 'bearish' && p < currentPrice * 0.95) {
          // Short entry too far below current price
          console.log(`[GroqAnalyzer] Short entry ${p} too far below current ${currentPrice}, rejecting`);
          return null;
        }
        
        return p; // Return validated suggested entry
      }
      
      // For SL/TP: validate within reasonable range (50%-150% of current price)
      const maxPrice = currentPrice * 1.5;
      const minPrice = currentPrice * 0.5;
      
      if (p > maxPrice || p < minPrice) {
        console.log(`[GroqAnalyzer] Fixing unrealistic ${type}: ${p} (outside valid range of ${currentPrice})`);
        return null;
      }
      
      // Additional validation: ensure stop loss is at least 1% away from entry
      if (type === 'stop_loss' && suggestedEntry) {
        const distance = Math.abs(p - suggestedEntry);
        const minDistance = suggestedEntry * 0.01; // 1% minimum
        if (distance < minDistance) {
          console.log(`[GroqAnalyzer] Stop loss ${p} too close to entry ${suggestedEntry} (distance ${distance.toFixed(2)} < minimum ${minDistance.toFixed(2)}), rejecting`);
          return null;
        }

        // Validate SL is on correct side of entry based on bias
        if (bias === 'bullish' && p >= suggestedEntry) {
          // For long: SL must be below entry
          console.log(`[GroqAnalyzer] Long stop loss ${p} must be below entry ${suggestedEntry}, rejecting`);
          return null;
        }
        if (bias === 'bearish' && p <= suggestedEntry) {
          // For short: SL must be above entry
          console.log(`[GroqAnalyzer] Short stop loss ${p} must be above entry ${suggestedEntry}, rejecting`);
          return null;
        }
      }

      // Validate TP is on correct side of entry based on bias
      if (type === 'take_profit' && suggestedEntry && bias) {
        if (bias === 'bullish' && p <= suggestedEntry) {
          // For long: TP must be above entry
          console.log(`[GroqAnalyzer] Long take profit ${p} must be above entry ${suggestedEntry}, rejecting`);
          return null;
        }
        if (bias === 'bearish' && p >= suggestedEntry) {
          // For short: TP must be below entry
          console.log(`[GroqAnalyzer] Short take profit ${p} must be below entry ${suggestedEntry}, rejecting`);
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
      reason_summary: coinData?.reason_summary ? coinData.reason_summary.substring(0, 200) : null
    };
  };

  return {
    btc: formatCoin(rawResponse?.btc, priceData.btc?.price || 0),
    eth: formatCoin(rawResponse?.eth, priceData.eth?.price || 0),
    comparison: rawResponse?.comparison || '',
    marketSentiment: rawResponse?.marketSentiment || 'neutral',
  };
}

/**
 * Generate fallback analysis when Groq fails
 */
function generateFallbackAnalysis(priceData) {
  console.log('[GroqAnalyzer] Generating fallback ICT analysis');

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
    comparison: 'ICT analysis requires full data',
    marketSentiment: 'neutral',
  };
}
