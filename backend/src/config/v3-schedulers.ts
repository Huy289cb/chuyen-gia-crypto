/**
 * Big Update v3 worker cron schedules (single source of truth).
 * MarketScan runs at :00,:05,...; LLMDispatch at :02,:17,:32,:47 so scan cache is fresh.
 */
export const V3_MARKET_SCAN_CRON = '*/5 * * * *';

/** +2 min after each 15m boundary — after a typical ~55s MarketScan cycle completes */
export const V3_LLM_DISPATCH_CRON = '2,17,32,47 * * * *';

export const V3_SIGNAL_GATE_TIMEFRAMES = ['15m', '1h', '4h'] as const;
