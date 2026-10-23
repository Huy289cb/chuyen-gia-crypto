"use strict";
/** Freshness policy for HTF snapshots consumed by live entry hard gates. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HTF_SCAN_MAX_AGE_MS = void 0;
exports.getHtfScanMaxAgeMs = getHtfScanMaxAgeMs;
exports.evaluateScanFreshness = evaluateScanFreshness;
exports.DEFAULT_HTF_SCAN_MAX_AGE_MS = 10 * 60_000;
function getHtfScanMaxAgeMs() {
    const value = parseInt(process.env.V3_HTF_SCAN_MAX_AGE_MS || String(exports.DEFAULT_HTF_SCAN_MAX_AGE_MS), 10);
    return Number.isFinite(value) && value > 0 ? value : exports.DEFAULT_HTF_SCAN_MAX_AGE_MS;
}
/** Missing, invalid, future-dated, or stale timestamps fail closed. */
function evaluateScanFreshness(timestamp, options) {
    const label = options?.label ?? 'HTF';
    if (timestamp == null) {
        return { pass: false, reason: `${label} scan unavailable (missing timestamp)` };
    }
    const timestampMs = timestamp instanceof Date ? timestamp.getTime() : Number(timestamp);
    const nowMs = options?.nowMs ?? Date.now();
    const maxAgeMs = options?.maxAgeMs ?? getHtfScanMaxAgeMs();
    if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) {
        return { pass: false, reason: `${label} scan unavailable (invalid timestamp)` };
    }
    const ageMs = nowMs - timestampMs;
    if (ageMs < 0) {
        return { pass: false, ageMs, reason: `${label} scan unavailable (future timestamp)` };
    }
    if (ageMs > maxAgeMs) {
        const ageMinutes = (ageMs / 60_000).toFixed(1);
        const maxMinutes = (maxAgeMs / 60_000).toFixed(1);
        return {
            pass: false,
            ageMs,
            reason: `${label} scan stale (${ageMinutes}m > ${maxMinutes}m max)`,
        };
    }
    return { pass: true, ageMs };
}
//# sourceMappingURL=scan-freshness.js.map