/**
 * Profit protection: move exchange SL to breakeven / trail winners.
 * Does not cancel TP; only tightens stop_loss.
 */
/** Master switch — default on for live PnL protection. */
export declare function isProfitProtectEnabled(): boolean;
/** Move SL to entry once unrealized profit >= this many R (entry→original SL). Default 1.5. */
export declare function getBreakevenAtR(): number;
/** Activate trailing when unrealized PnL % of entry reaches this. Default 2.5 (~near RR3). */
export declare function getTrailActivatePct(): number;
/** Trail distance behind mark (percent of price). Default 0.55. */
export declare function getTrailDistancePct(): number;
/** Ignore tiny SL improvements (percent of entry). */
export declare function getMinSlMovePct(): number;
/** Min position age before first SL tighten (minutes). */
export declare function getProfitProtectMinMinutes(): number;
/**
 * After this many hours, if still green but below BE threshold, nudge SL to entry.
 * 0 = disabled (default — RR3 swings often need >24h; 24h BE scratched winners).
 */
export declare function getTimeStopHours(): number;
/**
 * Place BE stop this many % of entry into profit (covers fees/slip).
 * Long: entry*(1+buf), short: entry*(1-buf). Default 0.08%.
 */
export declare function getBreakevenFeeBufferPct(): number;
//# sourceMappingURL=profit-protect-policy.d.ts.map