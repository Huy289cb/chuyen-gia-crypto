// Groq Analyzer Module - ICT Smart Money Concepts
// Multi-timeframe analysis using Groq LLM API

import { createGroqClient } from './groq-client.js';

// Lazy load groqClient to ensure env vars are loaded
let groqClient = null;
const getGroqClient = () => {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = createGroqClient(process.env.GROQ_API_KEY);
  }
  return groqClient;
};

/**
 * Analyze price data using Groq API with multi-timeframe approach
 * @param {Object} priceData - Price data from fetchPrices
 * @param {Object} db - Optional database connection for historical context
 * @returns {Promise<Object>} Analysis result
 */
export async function analyzeWithGroq(priceData, db = null) {
  try {
    const client = getGroqClient();
    
    // If no Groq API key, use fallback immediately
    if (!client) {
      console.log('[GroqAnalyzer] No API key, using fallback analysis');
      return generateFallbackAnalysis(priceData);
    }

    console.log('[GroqAnalyzer] Starting ICT Smart Money analysis...');

    // Fetch historical prediction context if database is available
    let historicalContext = '';
    if (db) {
      try {
        const { getRecentAnalysisWithPredictions } = await import('./db/database.js');
        
        // Get predictions from last 24 hours, limit to 10 per coin
        const btcHistory = await getRecentAnalysisWithPredictions(db, 'BTC', 20);
        const ethHistory = await getRecentAnalysisWithPredictions(db, 'ETH', 20);
        
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
        
        if (btcContext || ethContext) {
          historicalContext = `\n\nPREDICTION HISTORY (24H):\n${btcContext}\n${ethContext}\n\nReview past accuracy. If recent predictions were incorrect, be more conservative. If accurate, maintain confidence.`;
          console.log('[GroqAnalyzer] Historical prediction context included');
        } else {
          console.log('[GroqAnalyzer] No historical predictions available in last 24h');
        }
      } catch (error) {
        console.log('[GroqAnalyzer] Failed to fetch historical context:', error.message);
      }
    } else {
      console.log('[GroqAnalyzer] Database not available, skipping historical context');
    }

    const systemPrompt = `You are an ICT (Inner Circle Trader) crypto analyst. Use Smart Money Concepts. Return ONLY valid JSON with ALL text fields in VIETNAMESE language.

CORE FRAMEWORK:

1. MULTI-TIMEFRAME (Priority: 1d > 4h > 1h > 15m)
   - Analyze structure on each timeframe
   - Identify BOS (Break of Structure) or CHOCH (Change of Character)

2. MARKET STRUCTURE
   - Bullish: Higher Highs (HH), Higher Lows (HL)
   - Bearish: Lower Highs (LH), Lower Lows (LL)

3. LIQUIDITY
   - Buy-side: above recent highs (targets for longs)
   - Sell-side: below recent lows (targets for shorts)
   - Price tends to sweep liquidity before reversing

4. ORDER BLOCKS
   - Last opposing candle before strong impulse move
   - Mark these as institutional reference levels

5. FAIR VALUE GAPS (FVG)
   - Imbalances where price moved quickly, leaving gaps
   - Price often returns to fill FVG

6. NARRATIVE (CRITICAL - in Vietnamese)
   Tell the story in Vietnamese:
   - Where is price now relative to structure?
   - Where is liquidity resting?
   - What did price just do? (sweep, BOS, CHOCH)
   - Where is price likely to go next?

7. DECISION LOGIC
   BUY:
   - Bullish HTF bias (4h/1d)
   - Price at discount or near support
   - Liquidity taken below
   - Bullish BOS/CHOCH confirmed
   
   SELL:
   - Bearish HTF bias
   - Price at premium or near resistance
   - Liquidity taken above
   - Bearish BOS/CHOCH confirmed
   
   HOLD:
   - Conflicting signals across timeframes
   - No clear liquidity target
   - Sideways consolidation

9. PREDICTIONS (Based on ICT analysis)
   For each timeframe (15m, 1h, 4h, 1d):
   - Direction: up/down/sideways
   - Target: next liquidity level or FVG fill zone
   - Confidence: 0-1 based on structure clarity
   
   Example: "15m": { "direction": "up", "target": 67500, "confidence": 0.7 }

OUTPUT FORMAT (STRICT JSON, ALL TEXT IN VIETNAMESE):
{
  "btc": {
    "bias": "bullish | bearish | neutral",
    "action": "buy | sell | hold",
    "confidence": 0-1,
    "narrative": "max 350 characters in Vietnamese - tell the market story with details about structure, liquidity, and price action",
    "timeframes": {
      "15m": "structure description in Vietnamese",
      "1h": "structure description in Vietnamese",
      "4h": "structure description in Vietnamese", 
      "1d": "structure description in Vietnamese"
    },
    "key_levels": {
      "liquidity": "where liquidity rests in Vietnamese",
      "order_blocks": "key institutional levels in Vietnamese",
      "fvg": "imbalance zones in Vietnamese",
      "bos": "break of structure levels in Vietnamese",
      "choch": "change of character levels in Vietnamese"
    },
    "predictions": {
      "15m": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 },
      "1h": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 },
      "4h": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 },
      "1d": { "direction": "up | down | sideways", "target": number, "confidence": 0-1 }
    },
    "risk": "volatility warning + invalidation scenario in Vietnamese",
    "suggested_entry": number (optional - specific entry price if bias is clear),
    "suggested_stop_loss": number (optional - SL below swing low for long, above swing high for short),
    "suggested_take_profit": number (optional - TP at liquidity target or FVG fill),
    "expected_rr": number (optional - risk/reward ratio, minimum 2.0),
    "invalidation_level": number (optional - price level that invalidates the setup),
    "reason_summary": "brief reason in Vietnamese for the trading suggestion (max 200 chars)"
  },
  "eth": { ... same structure ... },
  "marketSentiment": "bullish | bearish | neutral | mixed",
  "comparison": "brief analysis comparing BTC vs ETH in Vietnamese"
}

RULES:
- ALL text fields must be in Vietnamese language
- Build narrative BEFORE decision
- If signals conflict → HOLD
- Predictions must target specific liquidity/FVG levels
- Only provide suggested_entry, suggested_stop_loss, suggested_take_profit if confidence >= 0.8 and bias is clear
- SL should be placed below recent swing low (long) or above swing high (short)
- TP should target next liquidity level or FVG fill zone with minimum 1:2 R:R
- expected_rr must be >= 2.0 if suggesting a trade
- No text outside JSON
- reasoning ≤ 350 characters in Vietnamese`;

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

    console.log('[GroqAnalyzer] BTC timeframe changes:', btcChanges);
    console.log('[GroqAnalyzer] ETH timeframe changes:', ethChanges);

    const userPrompt = `Analyze BTC and ETH using ICT Smart Money Concepts.

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
Apply ICT methodology:
1. Check multi-timeframe structure (15m, 1h, 4h, 1d)
2. Identify liquidity levels (recent highs/lows)
3. Look for BOS (Break of Structure) or CHOCH (Change of Character) patterns
4. Note any FVGs in recent price action
5. Build narrative: Where is price? Where is liquidity? Where is it going?
6. Give directional bias and action
7. Market Sentiment: Determine overall market sentiment (bullish/bearish/neutral/mixed) based on both coins
8. Comparison: Briefly compare BTC vs ETH performance and structure

IMPORTANT: Identify specific price levels for:
- BOS: Price where structure broke (new highs/lows)
- CHOCH: Price where character changed from trend to range or reverse

Return ONLY valid JSON following the system format.`;

    const response = await client.analyze({
      systemPrompt,
      userPrompt,
      temperature: 0.3,
      maxRetries: 2
    });

    // Validate and format response
    const analysis = formatAnalysisResponse(response, priceData);
    console.log('[GroqAnalyzer] ICT Analysis complete');
    console.log(`  BTC: ${analysis.btc.action} | bias: ${analysis.btc.bias} | confidence: ${(analysis.btc.confidence * 100).toFixed(0)}%`);
    console.log(`  ETH: ${analysis.eth.action} | bias: ${analysis.eth.bias} | confidence: ${(analysis.eth.confidence * 100).toFixed(0)}%`);
    
    return analysis;

  } catch (error) {
    console.error('[GroqAnalyzer] Error:', error.message);
    console.log('[GroqAnalyzer] Falling back to rule-based analysis');
    return generateFallbackAnalysis(priceData);
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

    // Validate trading suggestion fields
    const validatePriceLevel = (price, currentPrice, type) => {
      if (!price || isNaN(price)) return null;
      
      const p = parseFloat(price);
      // Ensure price is within reasonable range
      const maxPrice = currentPrice * 1.5;
      const minPrice = currentPrice * 0.5;
      
      if (p > maxPrice || p < minPrice) {
        console.log(`[GroqAnalyzer] Fixing unrealistic ${type}: ${p}`);
        return null;
      }
      
      return p;
    };
    
    return {
      bias: hasValidPredictions && ['bullish', 'bearish', 'neutral'].includes(coinData?.bias) 
        ? coinData.bias 
        : 'neutral',
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
      // New trading suggestion fields
      current_price: currentPrice,
      suggested_entry: validatePriceLevel(coinData?.suggested_entry, currentPrice, 'entry'),
      suggested_stop_loss: validatePriceLevel(coinData?.suggested_stop_loss, currentPrice, 'stop_loss'),
      suggested_take_profit: validatePriceLevel(coinData?.suggested_take_profit, currentPrice, 'take_profit'),
      expected_rr: coinData?.expected_rr && !isNaN(coinData.expected_rr) ? Math.max(0, parseFloat(coinData.expected_rr)) : null,
      invalidation_level: validatePriceLevel(coinData?.invalidation_level, currentPrice, 'invalidation'),
      reason_summary: coinData?.reason_summary ? coinData.reason_summary.substring(0, 200) : null
    };
  };

  return {
    btc: formatCoin(rawResponse?.btc, priceData.btc?.price || 0),
    eth: formatCoin(rawResponse?.eth, priceData.eth?.price || 0),
    comparison: rawResponse?.comparison || '',
    marketSentiment: rawResponse?.marketSentiment || 'neutral',
    disclaimer: rawResponse?.disclaimer || 'This is NOT financial advice. Crypto is high risk. Only invest what you can afford to lose completely.'
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
    disclaimer: 'FALLBACK ANALYSIS: This is NOT financial advice. Smart Money Concepts require proper chart analysis. Crypto is extremely volatile. Never invest more than you can afford to lose.'
  };
}
