import type { SignalGateConfig, SignalGateOutput } from '../services/signal-gate.service';
export interface SignalGateTimeframeRow {
    timeframe: string;
    output: SignalGateOutput;
}
/** Human-readable gate failure (grade / confidence / regime). */
export declare function formatGateFailureReason(output: SignalGateOutput, config: Pick<SignalGateConfig, 'minGrade' | 'minConfidence' | 'allowedRegimes'>): string | null;
/**
 * Full block reason for DB / event log: gate rule + setup analysis.
 */
export declare function formatSignalGateBlockReason(output: SignalGateOutput, config: Pick<SignalGateConfig, 'minGrade' | 'minConfidence' | 'allowedRegimes'>): string;
/**
 * Single Telegram message for one market-scan cycle (all TFs).
 */
export declare function formatSignalGateTelegramScan(symbol: string, rows: SignalGateTimeframeRow[], config: SignalGateConfig): {
    title: string;
    body: string;
};
//# sourceMappingURL=signal-gate-format.d.ts.map