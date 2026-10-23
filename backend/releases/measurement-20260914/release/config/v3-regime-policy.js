"use strict";
/**
 * Regime classification thresholds + gate bypass rules (env-tunable).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegimeTrendMinPct = getRegimeTrendMinPct;
exports.getRegimeStrongTrendMinPct = getRegimeStrongTrendMinPct;
exports.isBreakoutRegimeBypassEnabled = isBreakoutRegimeBypassEnabled;
exports.shouldBypassRegimeForBreakout = shouldBypassRegimeForBreakout;
exports.regimeForGatePass = regimeForGatePass;
function parsePct(value, fallback) {
    const n = parseFloat(value ?? String(fallback));
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
/** Min linear trend strength (%) to classify as trend on each TF. */
function getRegimeTrendMinPct(timeframe) {
    switch (timeframe) {
        case '5m':
            return parsePct(process.env.V3_REGIME_TREND_MIN_5M, 0.1);
        case '15m':
            return parsePct(process.env.V3_REGIME_TREND_MIN_15M, 0.08);
        case '1h':
            return parsePct(process.env.V3_REGIME_TREND_MIN_1H, 0.06);
        case '4h':
            return parsePct(process.env.V3_REGIME_TREND_MIN_4H, 0.12);
        default:
            return parsePct(process.env.V3_REGIME_TREND_MIN_DEFAULT, 0.15);
    }
}
function getRegimeStrongTrendMinPct() {
    return parsePct(process.env.V3_REGIME_STRONG_TREND_MIN, 0.25);
}
/**
 * Grade-A breakout counts as directional impulse — bypass range-only block on 15m/1h.
 * Default on when trend-only (slope lags the break). Structure bias still blocks the wrong side.
 */
function isBreakoutRegimeBypassEnabled() {
    if (process.env.V3_BREAKOUT_REGIME_BYPASS === 'false') {
        return false;
    }
    if (process.env.V3_BREAKOUT_REGIME_BYPASS === 'true') {
        return true;
    }
    return (process.env.V3_ALLOWED_REGIMES?.trim() || 'trend') === 'trend';
}
const BREAKOUT_BYPASS_TFS = new Set(['5m', '15m', '1h']);
function shouldBypassRegimeForBreakout(timeframe, playbookKey, grade) {
    if (!isBreakoutRegimeBypassEnabled() || !BREAKOUT_BYPASS_TFS.has(timeframe)) {
        return false;
    }
    if (playbookKey !== 'breakout_volume') {
        return false;
    }
    return grade === 'A';
}
function regimeForGatePass(input) {
    const { timeframe, localRegime, htfRegime, playbookKey, grade, alignHtf } = input;
    if (shouldBypassRegimeForBreakout(timeframe, playbookKey, grade)) {
        return 'trend';
    }
    if (alignHtf) {
        return alignHtf(timeframe, localRegime, htfRegime);
    }
    return localRegime;
}
//# sourceMappingURL=v3-regime-policy.js.map