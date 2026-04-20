// Test fixtures for OHLC data

export const sampleOHLCData = [
  { time: 1713600000000, open: 75000, high: 75500, low: 74900, close: 75400 },
  { time: 1713600060000, open: 75400, high: 75600, low: 75300, close: 75500 },
  { time: 1713600120000, open: 75500, high: 75800, low: 75400, close: 75700 },
  { time: 1713600180000, open: 75700, high: 75900, low: 75600, close: 75800 },
  { time: 1713600240000, open: 75800, high: 76000, low: 75700, close: 75900 },
  { time: 1713600300000, open: 75900, high: 76200, low: 75800, close: 76100 },
  { time: 1713600360000, open: 76100, high: 76300, low: 76000, close: 76200 },
  { time: 1713600420000, open: 76200, high: 76500, low: 76100, close: 76400 },
  { time: 1713600480000, open: 76400, high: 76600, low: 76300, close: 76500 },
  { time: 1713600540000, open: 76500, high: 76800, low: 76400, close: 76700 },
  { time: 1713600600000, open: 76700, high: 76900, low: 76600, close: 76800 },
  { time: 1713600660000, open: 76800, high: 77000, low: 76700, close: 76900 },
  { time: 1713600720000, open: 76900, high: 77200, low: 76800, close: 77100 },
  { time: 1713600780000, open: 77100, high: 77300, low: 77000, close: 77200 },
  { time: 1713600840000, open: 77200, high: 77500, low: 77100, close: 77400 },
  { time: 1713600900000, open: 77400, high: 77600, low: 77300, close: 77500 },
  { time: 1713600960000, open: 77500, high: 77800, low: 77400, close: 77700 },
  { time: 1713601020000, open: 77700, high: 77900, low: 77600, close: 77800 },
  { time: 1713601080000, open: 77800, high: 78000, low: 77700, close: 77900 },
  { time: 1713601140000, open: 77900, high: 78200, low: 77800, close: 78100 },
];

export const sampleAIResponse = {
  btc: {
    bias: 'bullish',
    action: 'buy',
    confidence: 0.82,
    narrative: 'Market structure bullish with strong volume',
    structure: {
      trend: 'bullish',
      hh_hl: 'Higher highs and higher lows',
      bos_choch: 'Break of structure confirmed'
    },
    volume: {
      profile: 'expanding',
      breakout_confirmed: true,
      key_zone_participation: 'High volume at support'
    },
    liquidity: {
      eqh_eql: 'Equal highs at 78000',
      buy_side: 'Strong buy side liquidity',
      sell_side: 'Moderate sell side liquidity',
      stop_hunt_zones: 'Stop hunt at 77500'
    },
    smc: {
      ob: 'Order block at 74800',
      fvg: 'Fair value gap 75000-75200',
      bos_choch: 'Break of structure at 77000'
    },
    breakout_retest: {
      has_breakout: true,
      is_fake: false,
      retest_pending: false,
      analysis: 'Valid breakout with volume confirmation'
    },
    price_prediction: {
      direction: 'up',
      target: 78000,
      confidence: 0.75
    },
    risk: 'Moderate volatility, invalidation at 74000',
    suggested_entry: 75412.1,
    suggested_stop_loss: 74800,
    suggested_take_profit: 78000,
    expected_rr: 2.5,
    invalidation_level: 74000,
    reason_summary: 'Bullish setup with strong volume, entry at 75412, SL 74800, TP 78000',
    position_decisions: {
      recommendations: [],
      overall_strategy: 'Hold current positions, wait for confirmation'
    },
    alternative_scenario: {
      trigger: 'Price drops below 75000',
      new_bias: 'bearish',
      new_entry: 74800,
      new_sl: 75500,
      new_tp: 73500,
      logic: 'Structure breakdown, volume shift to sell side'
    }
  },
  marketSentiment: 'bullish',
  comparison: 'BTC showing stronger momentum than ETH'
};
