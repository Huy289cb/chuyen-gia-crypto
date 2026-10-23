import { type AdaptiveSetupKind } from '../config/adaptive-setup-policy';
import { type AdaptiveSide } from '../utils/adaptive-setup';
import type { BacktestCandle } from './types';
export interface AdaptiveReplayCandidate {
    kind: AdaptiveSetupKind;
    side: AdaptiveSide;
    timeframe: '5m' | '15m';
    grade: string;
    boundary: number;
    detectedAt: number;
    breakoutBarOpenMs: number;
    expiresAt: number;
    context: Record<string, unknown>;
}
export interface AdaptiveReplayOutcome {
    kind: AdaptiveSetupKind;
    side: AdaptiveSide;
    timeframe: string;
    grade: string;
    detectedAt: number;
    confirmedAt: number;
    closedAt: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    closePrice: number;
    closeReason: 'stop_loss' | 'take_profit' | 'max_hold' | 'end_of_data';
    grossR: number;
    netR: number;
    barsHeld: number;
    context: Record<string, unknown>;
}
export interface AdaptiveReplayResult {
    period: {
        start: string;
        end: string;
    };
    config: {
        minSlPct: number;
        feePctPerSide: number;
        maxHoldHours: number;
        rangeEdgeFraction: number;
        microBosStrength: number;
        rangeRequireMicroBos: boolean;
        microRequire1hAlign: boolean;
        rangeLong5mOnly: boolean;
    };
    byKind: Record<AdaptiveSetupKind, AdaptiveReplayStats>;
    outcomes: AdaptiveReplayOutcome[];
}
export interface AdaptiveReplayStats {
    candidates: number;
    confirmed: number;
    expired: number;
    invalidated: number;
    outcomes: number;
    wins: number;
    losses: number;
    sumNetR: number;
    avgNetR: number;
    profitFactorNet: number | null;
}
/**
 * Closed-candle, stateful replay of candidate -> later retest -> fixed SL/TP.
 * Each setup family is evaluated as an independent strategy so one family
 * cannot hide another merely by occupying the single live position slot.
 */
export declare function runAdaptiveSetupReplay(input: {
    byTf: Record<string, BacktestCandle[]>;
    start: Date;
    end: Date;
    symbol?: string;
    minSlPct?: number;
    feePctPerSide?: number;
    maxHoldHours?: number;
    rrByKind?: Partial<Record<AdaptiveSetupKind, number>>;
    ttlByKind?: Partial<Record<AdaptiveSetupKind, number>>;
    rangeEdgeFraction?: number;
    microBosStrength?: number;
    rangeRequireMicroBos?: boolean;
    microRequire1hAlign?: boolean;
    rangeLong5mOnly?: boolean;
    candidateFilter?: (candidate: AdaptiveReplayCandidate) => boolean;
}): Promise<AdaptiveReplayResult>;
//# sourceMappingURL=adaptive-setup-replay.d.ts.map