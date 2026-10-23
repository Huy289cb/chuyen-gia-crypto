"use strict";
/**
 * Extreme funding crowd veto (offense filter — not size cut).
 * Positive funding → longs pay shorts → block new longs when |rate| high.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFundingVetoEnabled = isFundingVetoEnabled;
exports.getFundingVetoAbs = getFundingVetoAbs;
exports.evaluateFundingVeto = evaluateFundingVeto;
exports.fetchCachedFundingRate = fetchCachedFundingRate;
function isFundingVetoEnabled() {
    return process.env.FUNDING_VETO_ENABLED === 'true';
}
function getFundingVetoAbs() {
    const raw = process.env.FUNDING_VETO_ABS?.trim();
    const n = raw ? parseFloat(raw) : 0.0003;
    return Number.isFinite(n) && n > 0 ? n : 0.0003;
}
/**
 * @param fundingRate Binance lastFundingRate (e.g. 0.0003 = 0.03%)
 * Fail-open when rate is null (fetch error) — caller decides.
 */
function evaluateFundingVeto(input) {
    const enabled = input.enabled ?? isFundingVetoEnabled();
    if (!enabled)
        return { pass: true };
    const rate = input.fundingRate;
    if (rate == null || !Number.isFinite(rate)) {
        return { pass: true, reason: 'funding unavailable — fail open' };
    }
    const abs = input.absThreshold ?? getFundingVetoAbs();
    if (Math.abs(rate) < abs) {
        return { pass: true, reason: `funding ${rate} within ±${abs}` };
    }
    if (rate > 0 && input.side === 'long') {
        return {
            pass: false,
            reason: `blocked: long into high positive funding ${rate} (>= ${abs}) (FUNDING_VETO)`,
        };
    }
    if (rate < 0 && input.side === 'short') {
        return {
            pass: false,
            reason: `blocked: short into high negative funding ${rate} (<= -${abs}) (FUNDING_VETO)`,
        };
    }
    return { pass: true, reason: `funding ${rate} ok for ${input.side}` };
}
let cached = null;
const CACHE_MS = 60_000;
/** Cached lastFundingRate; null on failure (caller fail-open). */
async function fetchCachedFundingRate(symbol, fetchPremium) {
    const now = Date.now();
    if (cached && cached.symbol === symbol && now - cached.at < CACHE_MS) {
        return cached.rate;
    }
    try {
        const px = await fetchPremium(symbol);
        cached = { symbol, rate: px.lastFundingRate, at: now };
        return px.lastFundingRate;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=funding-veto.js.map