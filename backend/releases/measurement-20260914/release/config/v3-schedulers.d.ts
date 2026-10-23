/**
 * Big Update v3 worker cron schedules + signal-gate timeframes (single source of truth).
 * MarketScan runs five seconds after each 5m boundary so Binance has finalized the
 * just-closed kline; LLMDispatch remains +1 min after the boundary.
 */
export declare const V3_MARKET_SCAN_CRON: string;
/** Default: 1 min after each 5m scan when using 5m stack */
export declare const V3_LLM_DISPATCH_CRON: string;
declare const V3_VALID_GATE_TIMEFRAMES: readonly ["5m", "15m", "1h", "4h"];
export type V3GateTimeframe = (typeof V3_VALID_GATE_TIMEFRAMES)[number];
/** Active signal-gate timeframes from env (default 5m,15m,1h). */
export declare function getV3SignalGateTimeframes(): readonly string[];
/** Lower rank = preferred when grade/confidence tie (dashboard display). */
export declare function getV3TfPriorityRank(): Record<string, number>;
/**
 * LLM entry dispatch priority — default structure-first: 15m → 1h → 5m.
 * When 15m passes gate, prefer it over 5m for Groq/execution.
 */
export declare function getV3EntryTfPriorityRank(): Record<string, number>;
/** Duplicate-signal cache TTL — 5m when stack includes 5m. */
export declare function getSignalGateCacheTtlMs(): number;
/** OHLCV warmup targets per TF (dashboard + health). */
export declare function getV3WarmupRequiredCandles(): Record<string, number>;
export declare function getV3WarmupTimeframes(): string[];
/** @deprecated Use getV3SignalGateTimeframes() — kept for type imports */
export declare const V3_SIGNAL_GATE_TIMEFRAMES: readonly ["5m", "15m", "1h"];
export {};
//# sourceMappingURL=v3-schedulers.d.ts.map