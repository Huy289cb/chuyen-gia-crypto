"use strict";
/**
 * Position invalidation — structure-based tighten / red exit.
 * See docs/position-invalidation-plan.md
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInvalidationEnabled = isInvalidationEnabled;
exports.isInvalidationExitEnabled = isInvalidationExitEnabled;
exports.getInvalidationMinScore = getInvalidationMinScore;
exports.getInvalidationMinMinutes = getInvalidationMinMinutes;
exports.getInvalidationMinUpnlPct = getInvalidationMinUpnlPct;
exports.getInvalidationHtfLostMinHours = getInvalidationHtfLostMinHours;
exports.getInvalidationCooldownMs = getInvalidationCooldownMs;
exports.getInvalidationHtfTf = getInvalidationHtfTf;
exports.getInvalidationLtfTf = getInvalidationLtfTf;
function envFloat(name, fallback) {
    const v = parseFloat(process.env[name] || String(fallback));
    return Number.isFinite(v) && v >= 0 ? v : fallback;
}
function envInt(name, fallback) {
    const v = parseInt(process.env[name] || String(fallback), 10);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
}
/** Master switch — default on. */
function isInvalidationEnabled() {
    return process.env.INVALIDATION_ENABLED !== 'false';
}
/**
 * When score≥min, market-exit (green or red). Default on.
 * Invalidation no longer tightens to BE — thesis dead → flat.
 */
function isInvalidationExitEnabled() {
    return process.env.INVALIDATION_ALLOW_EXIT !== 'false';
}
function getInvalidationMinScore() {
    return envFloat('INVALIDATION_MIN_SCORE', 2);
}
function getInvalidationMinMinutes() {
    return envInt('INVALIDATION_MIN_MINUTES', 30);
}
/** Require at least this unrealized % before BE tighten. */
function getInvalidationMinUpnlPct() {
    return envFloat('INVALIDATION_MIN_UPNL_PCT', 0.15);
}
/** Soft signal: HTF lost trend after this many hours + weak R. */
function getInvalidationHtfLostMinHours() {
    return envFloat('INVALIDATION_HTF_LOST_MIN_HOURS', 6);
}
function getInvalidationCooldownMs() {
    return envInt('INVALIDATION_COOLDOWN_MS', 900_000);
}
/** Primary TF for HTF regime / trendDirection (default 1h). */
function getInvalidationHtfTf() {
    return process.env.INVALIDATION_HTF_TF?.trim() || '1h';
}
/** Secondary TF for adverse sweep/breakout (default 15m). */
function getInvalidationLtfTf() {
    return process.env.INVALIDATION_LTF_TF?.trim() || '15m';
}
//# sourceMappingURL=position-invalidation-policy.js.map