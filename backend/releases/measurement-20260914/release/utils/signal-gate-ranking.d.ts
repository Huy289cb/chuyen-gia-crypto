import type { SignalGateOutput } from '../services/signal-gate.service';
/** Dashboard / display — higher grade first, then TF priority. */
export declare function compareSignalGateEvaluations(a: {
    timeframe: string;
    result: SignalGateOutput;
}, b: {
    timeframe: string;
    result: SignalGateOutput;
}): number;
/** LLM entry — prefer 15m structure when multiple TFs pass. */
export declare function compareSignalGateForEntry(a: {
    timeframe: string;
    result: SignalGateOutput;
}, b: {
    timeframe: string;
    result: SignalGateOutput;
}): number;
//# sourceMappingURL=signal-gate-ranking.d.ts.map