"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOptimizedRangeRetest = isOptimizedRangeRetest;
exports.validateOptimizedRangeRetest = validateOptimizedRangeRetest;
exports.buildRangeRetestReviewPrompt = buildRangeRetestReviewPrompt;
const adaptive_setup_policy_1 = require("../config/adaptive-setup-policy");
const range_target_room_1 = require("./range-target-room");
const trade_levels_1 = require("./trade-levels");
const risk_policy_1 = require("../config/risk-policy");
function isOptimizedRangeRetest(context) {
    return Boolean(context &&
        context.candidateKind === 'range_sweep_reclaim' &&
        context.side === 'long' &&
        Number.isFinite(context.confirmedEntryPrice) &&
        context.confirmedEntryPrice > 0 &&
        Math.abs(context.minRr - 1.5) < 1e-9);
}
/** Dedicated gate for the configured long-5m range policy; historical results are not live proof. */
function validateOptimizedRangeRetest(input) {
    if (!isOptimizedRangeRetest(input.context)) {
        return { pass: false, reason: 'adaptive range retest context is not live-policy eligible' };
    }
    if (input.timeframe !== '5m') {
        return { pass: false, reason: `adaptive range retest requires 5m, got ${input.timeframe}` };
    }
    const setup = input.signalResult?.setupResult;
    if (setup?.playbookKey !== 'liquidity_sweep_reclaim' ||
        (setup.grade !== 'A' && setup.grade !== 'B')) {
        return { pass: false, reason: 'adaptive range retest requires A/B liquidity sweep evidence' };
    }
    if (!input.htf1h.fresh || input.htf1h.regime !== 'range') {
        return { pass: false, reason: `adaptive range retest requires fresh 1h range, got ${input.htf1h.regime}` };
    }
    if (input.structureBias === 'bear') {
        return { pass: false, reason: 'adaptive range long blocked by 4h bear structure' };
    }
    if ((0, adaptive_setup_policy_1.isRangeSweepTargetRoomRequired)()) {
        const levels = (0, trade_levels_1.computePolicyCompliantStopAndTarget)({ action: 'buy',
            entry: input.context.confirmedEntryPrice, minSlPct: (0, risk_policy_1.getRiskPolicy)().minSlDistancePercent,
            minRr: input.context.minRr });
        if (!levels || !(0, range_target_room_1.hasRangeTargetRoom)({ side: 'long', entry: input.context.confirmedEntryPrice,
            target: levels.takeProfit, rangeLow: input.context.rangeLow, rangeHigh: input.context.rangeHigh })) {
            return { pass: false, reason: 'adaptive range target exceeds observed range or bounds unavailable' };
        }
    }
    return {
        pass: true,
        reason: `validated range long 5m: 1h range, 4h ${input.structureBias}, RR1.5`,
    };
}
/** Keep the model's review contract aligned with the levels execution will actually use. */
function buildRangeRetestReviewPrompt(input) {
    const { context, stopLoss, takeProfit } = input;
    if (!isOptimizedRangeRetest(context) || !Number.isFinite(stopLoss) ||
        !Number.isFinite(takeProfit) || !(stopLoss > 0 && stopLoss < context.confirmedEntryPrice &&
        context.confirmedEntryPrice < takeProfit)) {
        throw new Error('Invalid range review contract');
    }
    return {
        systemPrompt: input.systemPrompt +
            `\n\nAPPROVED RANGE RETEST REVIEW CONTRACT (this request only):\n` +
            `Review a long 5m liquidity sweep, reclaim and later retest inside a 1h range. ` +
            `The strategy is mean reversion. Its required RR is ${context.minRr}; ` +
            `this specific RR replaces the general trend RR rule above for this candidate only. ` +
            `Review the exact entry, SL and TP provided in RANGE RETEST LEVELS. ` +
            `Confirm buy only if these levels and the observed structure support the trade. ` +
            `If SL is inside invalidation liquidity, TP is unsupported, or evidence is weak, return hold. ` +
            `Do not invent a breakout or extend TP to meet the trend RR. ` +
            `HOLD remains a valid veto; all confidence and direction rules still apply.`,
        userContext: `\n\nRANGE SWEEP / RECLAIM / RETEST:\n` +
            `Candidate: ${context.candidateKey}\n` +
            `Allowed side: long\nReclaimed boundary: ${context.boundaryPrice}\n` +
            (Number.isFinite(context.rangeLow) && Number.isFinite(context.rangeHigh)
                ? `Observed range: ${context.rangeLow} to ${context.rangeHigh}\n` : '') +
            `A later closed candle retested and held this boundary. Assess mean-reversion quality.\n` +
            `RANGE RETEST LEVELS: entry=${context.confirmedEntryPrice}, ` +
            `SL=${stopLoss}, TP=${takeProfit}, RR=${context.minRr}.\n` +
            `Execution uses these exact strategy levels if approved. HOLD if the plan is invalid.`,
    };
}
//# sourceMappingURL=adaptive-retest-dispatch.js.map