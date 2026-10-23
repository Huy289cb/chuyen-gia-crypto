/**
 * Regime classification thresholds + gate bypass rules (env-tunable).
 */
import type { MarketRegime } from '../analyzers/market-regime.analyzer';
/** Min linear trend strength (%) to classify as trend on each TF. */
export declare function getRegimeTrendMinPct(timeframe: string): number;
export declare function getRegimeStrongTrendMinPct(): number;
/**
 * Grade-A breakout counts as directional impulse — bypass range-only block on 15m/1h.
 * Default on when trend-only (slope lags the break). Structure bias still blocks the wrong side.
 */
export declare function isBreakoutRegimeBypassEnabled(): boolean;
export declare function shouldBypassRegimeForBreakout(timeframe: string, playbookKey: string | null, grade: 'A' | 'B' | 'C' | 'D'): boolean;
export declare function regimeForGatePass(input: {
    timeframe: string;
    localRegime: MarketRegime;
    htfRegime?: MarketRegime | null;
    playbookKey: string | null;
    grade: 'A' | 'B' | 'C' | 'D';
    alignHtf?: (tf: string, local: MarketRegime, htf: MarketRegime | null | undefined) => MarketRegime;
}): MarketRegime;
//# sourceMappingURL=v3-regime-policy.d.ts.map