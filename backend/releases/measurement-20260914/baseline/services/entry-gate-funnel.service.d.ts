/**
 * Non-short-circuit observability for deterministic entry gates.
 * This service never calls an LLM or places/cancels an exchange order.
 */
import type { SignalGateOutput } from './signal-gate.service';
import { type UnifiedCandle } from './candle.service';
import { type StructureBias, type StructureBiasResult } from '../config/v3-structure-bias-policy';
import { type TradeSide } from '../utils/setup-trade-side';
export type FunnelGateStatus = 'pass' | 'block' | 'unavailable' | 'not_applicable';
export interface FunnelGateResult {
    status: FunnelGateStatus;
    reason?: string;
    observed?: Record<string, unknown>;
}
export interface FunnelScanSnapshot {
    timestamp: Date;
    signalResult: SignalGateOutput;
    candles: UnifiedCandle[];
}
export interface EntryGateFunnelObservation {
    schema_version: 1;
    observation_key: string;
    bar_key: string;
    symbol: string;
    timeframe: string;
    evaluated_at: string;
    grade: string;
    confidence: number;
    playbook: string;
    side: TradeSide | null;
    local_regime: string;
    gate_regime: string;
    first_block: string | null;
    all_blocks: string[];
    would_pass_pre_llm: boolean;
    structure_bias: StructureBias | null;
    structure_detail: StructureBiasResult | null;
    breakout_metrics: Record<string, unknown> | null;
    gates: Record<string, FunnelGateResult>;
}
export interface EntryGateFunnelInput {
    symbol: string;
    timeframe: string;
    candles: UnifiedCandle[];
    signalResult: SignalGateOutput;
    getScan: (timeframe: string) => FunnelScanSnapshot | undefined;
    methodId?: string;
}
export declare function evaluateEntryGateFunnel(input: EntryGateFunnelInput): Promise<EntryGateFunnelObservation>;
export declare function recordEntryGateFunnel(input: EntryGateFunnelInput): Promise<EntryGateFunnelObservation | null>;
export declare function clearEntryGateFunnelDedupForTests(): void;
//# sourceMappingURL=entry-gate-funnel.service.d.ts.map