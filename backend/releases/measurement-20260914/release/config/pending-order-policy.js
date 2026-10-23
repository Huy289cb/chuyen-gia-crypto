"use strict";
/**
 * TTL and drift rules for unfilled limit pending orders (PnL+ lifecycle).
 * Short TTL on 5m/15m — long limits fill late into dead breakouts (e.g. 128m → SL).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENDING_ORDER_LIFECYCLE_CRON = void 0;
exports.getPendingOrderTtlHours = getPendingOrderTtlHours;
exports.getPendingOrderMaxDriftPct = getPendingOrderMaxDriftPct;
exports.isPendingOrderLifecycleEnabled = isPendingOrderLifecycleEnabled;
exports.isPendingOrderReviewEnabled = isPendingOrderReviewEnabled;
exports.getPendingOrderReviewMinConfidence = getPendingOrderReviewMinConfidence;
exports.getPendingOrderReviewMinAgeMinutes = getPendingOrderReviewMinAgeMinutes;
exports.getPendingOrderReentryCooldownMinutes = getPendingOrderReentryCooldownMinutes;
exports.getPostCloseSameSideCooldownMinutes = getPostCloseSameSideCooldownMinutes;
const DEFAULT_TTL_HOURS = {
    '5m': 0.75, // 45m
    '15m': 0.75, // 45m
    '1h': 2,
    '4h': 8,
};
function parseHours(envKey, fallback) {
    const raw = process.env[envKey]?.trim();
    if (!raw)
        return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function getPendingOrderTtlHours(timeframe) {
    const tf = (timeframe ?? '').toLowerCase();
    const maxHours = parseHours('PENDING_ORDER_TTL_MAX_HOURS', 8);
    if (tf === '5m') {
        return Math.min(parseHours('PENDING_ORDER_TTL_HOURS_5M', DEFAULT_TTL_HOURS['5m']), maxHours);
    }
    if (tf === '15m') {
        return Math.min(parseHours('PENDING_ORDER_TTL_HOURS_15M', DEFAULT_TTL_HOURS['15m']), maxHours);
    }
    if (tf === '1h') {
        return Math.min(parseHours('PENDING_ORDER_TTL_HOURS_1H', DEFAULT_TTL_HOURS['1h']), maxHours);
    }
    if (tf === '4h') {
        return Math.min(parseHours('PENDING_ORDER_TTL_HOURS_4H', DEFAULT_TTL_HOURS['4h']), maxHours);
    }
    return maxHours;
}
function getPendingOrderMaxDriftPct() {
    const raw = process.env.PENDING_ORDER_DRIFT_PCT?.trim();
    if (!raw)
        return 0.008;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0.008;
}
function isPendingOrderLifecycleEnabled() {
    return process.env.PENDING_ORDER_LIFECYCLE_ENABLED !== 'false';
}
exports.PENDING_ORDER_LIFECYCLE_CRON = process.env.PENDING_ORDER_LIFECYCLE_CRON?.trim() || '*/5 * * * *';
function isPendingOrderReviewEnabled() {
    return process.env.PENDING_ORDER_REVIEW_ENABLED !== 'false';
}
/** Min LLM confidence to cancel/modify (default 0.85 — match review prompt). */
function getPendingOrderReviewMinConfidence() {
    const raw = process.env.PENDING_ORDER_REVIEW_MIN_CONFIDENCE?.trim();
    if (!raw)
        return 0.85;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.85;
}
/** Do not AI-cancel a limit younger than this (default 60m). TTL/drift still apply. */
function getPendingOrderReviewMinAgeMinutes() {
    return parseHours('PENDING_ORDER_REVIEW_MIN_AGE_MINUTES', 60);
}
/**
 * After any pending cancel, block new place for this many minutes (default 45).
 * Stops Telegram place→cancel→place churn when LLM still likes the setup.
 */
function getPendingOrderReentryCooldownMinutes() {
    return parseHours('PENDING_ORDER_REENTRY_COOLDOWN_MINUTES', 45);
}
/**
 * After any closed position, block re-entry on either side (anti-chase / anti-flip).
 * Default 90m after close/win. After a loss: POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES (default 360m / 6h).
 * Env names keep SAME_SIDE for compat; behavior is any-side.
 */
function getPostCloseSameSideCooldownMinutes(wasLoss) {
    if (wasLoss) {
        return parseHours('POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES', 360);
    }
    return parseHours('POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES', 90);
}
//# sourceMappingURL=pending-order-policy.js.map