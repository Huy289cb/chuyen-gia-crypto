import { NextResponse } from 'next/server';

// Mock data for running analysis
const mockRunAnalysisData = {
  success: true,
  data: {
    prices: {
      timestamp: new Date().toISOString(),
      btc: {
        price: 80473.49,
        open: 80473.49,
        high: 80473.49,
        low: 80473.48,
        volume: 2.57259,
        time: new Date().toISOString(),
        prices1d: [75154.29,77072,75691.76,73801.79,75840.97,76336.15,78178.23,78257.48,77437.13,77625,78657.55,77371.32,76342.77,75780,76346.57,78231.13,78686.85,78568.57,79861.01,80905.52,81447.01,80006,80193.17,80473.49]
      },
      eth: {
        price: 2312.85,
        open: 2312.73,
        high: 2312.86,
        low: 2312.58,
        volume: 60.7809,
        time: new Date().toISOString(),
        prices1d: [2348.17,2419,2350.32,2263.27,2313.85,2327.14,2374.07,2330.26,2314.99,2319.5,2369.44,2303.67,2289.42,2252.9,2257.51,2295.63,2316.97,2322.65,2347.16,2360.77,2350.84,2291.06,2307.06,2312.85]
      }
    },
    analysis: {
      btc: {
        bias: "bullish",
        action: "buy",
        confidence: 0.85,
        narrative: "Bullish alignment on HTF, liquidity sweep detected, entry in Golden Pocket",
        scoring_detail: null,
        timeframes: {
          "15m": "neutral",
          "1h": "neutral", 
          "4h": "neutral",
          "1d": "neutral"
        },
        key_levels: {
          liquidity: "not identified",
          order_blocks: "not identified",
          fvg: "not identified",
          bos: "not identified",
          choch: "not identified"
        },
        predictions: {},
        risk: "Crypto markets are volatile - trade carefully",
        current_price: 80473.49,
        suggested_entry: 80473.49,
        suggested_stop_loss: 79751.19,
        suggested_take_profit: 82315.11,
        expected_rr: 2.57,
        invalidation_level: null,
        reason_summary: null,
        position_decisions: [],
        pending_order_decisions: [],
        alternative_scenario: null,
        breakout_retest: null,
        volume_analysis: null,
        structure: null,
        volume: 42711,
        avgVolume: 52145,
        liquidity_sweep_detected: true,
        order_block_distance: 0.005,
        fvg_distance: 0.003,
        break_of_structure: true,
        change_of_character: false,
        range_width: 0.008,
        indicators: {
          fibonacci: {
            retracement: [
              {level: 0.382, price: 76449.8155, label: "38.2%"},
              {level: 0.5, price: 78461.65275000001, label: "50%"},
              {level: 0.618, price: 80473.49, label: "61.8%"}
            ],
            extension: [
              {level: 1.272, price: 84497.16450000001, label: "127.2%"},
              {level: 1.618, price: 86911.36920000002, label: "161.8%"}
            ]
          }
        },
        orderBlocks: [],
        fairValueGaps: [],
        volume: "normal"
      },
      eth: {
        bias: "neutral",
        action: "hold", 
        confidence: 0.4,
        narrative: "No narrative provided",
        scoring_detail: null,
        timeframes: {
          "15m": "neutral",
          "1h": "neutral",
          "4h": "neutral", 
          "1d": "neutral"
        },
        key_levels: {
          liquidity: "not identified",
          order_blocks: "not identified",
          fvg: "not identified",
          bos: "not identified",
          choch: "not identified"
        },
        predictions: {},
        risk: "Crypto markets are volatile - trade carefully",
        current_price: 2312.85,
        suggested_entry: null,
        suggested_stop_loss: null,
        suggested_take_profit: null,
        expected_rr: null,
        invalidation_level: null,
        reason_summary: null,
        position_decisions: null,
        pending_order_decisions: null,
        alternative_scenario: null,
        breakout_retest: null,
        volume_analysis: null,
        structure: null,
        indicators: {
          fibonacci: {
            retracement: [
              {level: 0.382, price: 2197.2075, label: "38.2%"},
              {level: 0.5, price: 2255.02875, label: "50%"},
              {level: 0.618, price: 2312.85, label: "61.8%"}
            ],
            extension: [
              {level: 1.272, price: 2428.4925, label: "127.2%"},
              {level: 1.618, price: 2497.878, label: "161.8%"}
            ]
          }
        },
        orderBlocks: [],
        fairValueGaps: [],
        volume: "normal"
      }
    },
    comparison: "",
    marketSentiment: "neutral",
    raw_question: "Mock analysis request",
    raw_answer: '{"btc": {"bias": "bullish", "action": "buy", "confidence": 0.85, "narrative": "Bullish alignment on HTF, liquidity sweep detected, entry in Golden Pocket", "suggested_entry": 80473.49, "suggested_stop_loss": 79751.19, "suggested_take_profit": 82315.11, "expected_rr": 2.57, "volume": 42711, "avgVolume": 52145, "liquidity_sweep_detected": true, "order_block_distance": 0.005, "fvg_distance": 0.003, "break_of_structure": true, "change_of_character": false, "range_width": 0.008, "position_decisions": [], "pending_order_decisions": []}}',
    lastUpdated: new Date().toISOString()
  },
  message: "Analysis completed successfully"
};

export async function POST() {
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return NextResponse.json(mockRunAnalysisData);
}
