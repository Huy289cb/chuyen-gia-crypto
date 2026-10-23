import type { StructureBias } from '../config/v3-structure-bias-policy';
import type { SignalGateOutput } from '../services/signal-gate.service';
export interface RetestDispatchContext {
    candidateKey: string;
    candidateKind: string;
    side: 'long' | 'short';
    boundaryPrice: number;
    breakoutBarKey: string;
    confirmedEntryPrice: number;
    minRr: number;
    rangeLow?: number;
    rangeHigh?: number;
}
export declare function isOptimizedRangeRetest(context: RetestDispatchContext | undefined): boolean;
/** Dedicated gate for the configured long-5m range policy; historical results are not live proof. */
export declare function validateOptimizedRangeRetest(input: {
    context: RetestDispatchContext;
    timeframe: string;
    signalResult?: SignalGateOutput;
    htf1h: {
        fresh: boolean;
        regime: string;
    };
    structureBias: StructureBias;
}): {
    pass: boolean;
    reason: string;
};
/** Keep the model's review contract aligned with the levels execution will actually use. */
export declare function buildRangeRetestReviewPrompt(input: {
    systemPrompt: string;
    context: RetestDispatchContext;
    stopLoss: number;
    takeProfit: number;
}): {
    systemPrompt: string;
    userContext: string;
};
//# sourceMappingURL=adaptive-retest-dispatch.d.ts.map