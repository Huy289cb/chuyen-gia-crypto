/**
 * Setup Gate Analyzer
 */
import type { SetupGateEvidence } from './setup-gate.types';
export interface CandleData {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
}
export interface SetupGateResult {
    playbookKey: string | null;
    grade: 'A' | 'B' | 'C' | 'D';
    confidence: number;
    regime: 'trend' | 'range' | 'chop';
    reason: string;
    /** Full scan evidence (numbers from this candle window) */
    evidence: SetupGateEvidence;
    /** Multi-line detail for UI / Telegram */
    detailReason: string;
}
export interface SetupGateInput {
    candles: CandleData[];
    symbol: string;
    timeframe: string;
}
export declare function analyzeSetupGate(input: SetupGateInput): Promise<SetupGateResult>;
//# sourceMappingURL=setup-gate.analyzer.d.ts.map