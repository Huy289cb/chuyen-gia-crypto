import type { SetupGateResult, CandleData } from '../analyzers/setup-gate.analyzer';
export type TradeSide = 'long' | 'short';
/** Infer directional bias from playbook evidence (no LLM). */
export declare function inferSetupTradeSide(setup: SetupGateResult, timeframe: string, candles: CandleData[]): TradeSide | null;
//# sourceMappingURL=setup-trade-side.d.ts.map