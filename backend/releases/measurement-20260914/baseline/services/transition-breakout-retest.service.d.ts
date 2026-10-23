/**
 * Stateful breakout -> retest state machine.
 *
 * Transition setups are always shadow-only. Directional trend setups can be
 * re-armed for LLM dispatch only when pullback was the sole remaining blocker.
 * The normal dispatch/execution pipeline still revalidates every live gate.
 */
import type { UnifiedCandle } from './candle.service';
import type { EntryGateFunnelObservation, FunnelScanSnapshot } from './entry-gate-funnel.service';
import type { SignalGateOutput } from './signal-gate.service';
import { type AdaptiveSetupKind } from '../config/adaptive-setup-policy';
export type TransitionRetestSide = 'long' | 'short';
export interface TransitionRetestCandidate {
    schema_version: 1;
    candidate_key: string;
    wave_key: string;
    symbol: string;
    timeframe: string;
    side: TransitionRetestSide;
    grade: string;
    boundary_price: number;
    breakout_bar_key: string;
    breakout_bar_open_ms: number;
    breakout_close: number;
    volume_ratio: number | null;
    breakout_strength_pct: number | null;
    detected_at: string;
    expires_at: string;
    mode: string;
    candidate_kind: 'transition' | 'transition_resolution' | 'trend' | AdaptiveSetupKind;
    /** True when a dispatchable setup was admitted despite an earlier shadow wave. */
    shadow_wave_bypassed?: boolean;
    adaptive_evidence?: Record<string, unknown>;
    resolution_evidence?: {
        prior_swing_price: number;
        latest_swing_price: number;
        htf_timeframe: string;
        htf_direction: 'bullish' | 'bearish';
    };
    /** Original breakout evidence. Live dispatch reuses it with the retest candles. */
    signal_result?: SignalGateOutput;
}
interface ShadowRetestPosition extends TransitionRetestCandidate {
    confirmed_bar_open_ms: number;
    confirmed_at: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    rr: number;
}
export interface TransitionRetestOpportunity extends ShadowRetestPosition {
    signal_result: SignalGateOutput;
}
export interface TransitionRetestScanInput {
    symbol: string;
    timeframe: string;
    candles: UnifiedCandle[];
    getScan: (timeframe: string) => FunnelScanSnapshot | undefined;
    nowMs?: number;
}
export declare function registerTransitionRetestCandidate(observation: EntryGateFunnelObservation, candles: UnifiedCandle[], signalResult?: SignalGateOutput, nowMs?: number, getScan?: (timeframe: string) => FunnelScanSnapshot | undefined): Promise<TransitionRetestCandidate | null>;
export declare function processTransitionRetestScan(input: TransitionRetestScanInput): Promise<void>;
/** Oldest confirmed directional retest waiting for an LLM decision. */
export declare function peekTransitionRetestOpportunity(symbol: string, nowMs?: number): TransitionRetestOpportunity | null;
/** Claim before dispatch so a worker restart cannot submit the same retest twice. */
export declare function claimTransitionRetestOpportunity(candidateKey: string): Promise<TransitionRetestOpportunity | null>;
export declare function recordTransitionRetestDispatch(input: {
    opportunity: TransitionRetestOpportunity;
    decision: 'trade' | 'no_trade';
    reason: string;
    executionAttempted: boolean;
    executionSuccess?: boolean;
    executionReason?: string;
    decisionRecordId?: number;
}): Promise<void>;
export declare function resetTransitionRetestStateForTests(): void;
export declare function getTransitionRetestStateForTests(): {
    candidates: TransitionRetestCandidate[];
    positions: ShadowRetestPosition[];
    opportunities: TransitionRetestOpportunity[];
};
export {};
//# sourceMappingURL=transition-breakout-retest.service.d.ts.map