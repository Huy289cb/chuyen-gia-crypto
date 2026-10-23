"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdaptiveSetupMode = getAdaptiveSetupMode;
exports.isAdaptiveSetupShadowEnabled = isAdaptiveSetupShadowEnabled;
exports.isAdaptiveSetupLiveEnabled = isAdaptiveSetupLiveEnabled;
exports.isEarlyStructureFlipEnabled = isEarlyStructureFlipEnabled;
exports.isAlignedMicroBosEnabled = isAlignedMicroBosEnabled;
exports.isRangeSweepReclaimEnabled = isRangeSweepReclaimEnabled;
exports.isAlignedMicroBosRequire1hAlign = isAlignedMicroBosRequire1hAlign;
exports.isRangeSweepLong5mOnly = isRangeSweepLong5mOnly;
exports.getAdaptiveSetupTtlMinutes = getAdaptiveSetupTtlMinutes;
exports.getAdaptiveSetupRr = getAdaptiveSetupRr;
exports.getRangeSweepEdgeFraction = getRangeSweepEdgeFraction;
exports.getAdaptiveMicroBosStrength = getAdaptiveMicroBosStrength;
exports.isRangeSweepRetestBosRequired = isRangeSweepRetestBosRequired;
exports.isRangeSweepTargetRoomRequired = isRangeSweepTargetRoomRequired;
exports.getAdaptiveFeePctPerSide = getAdaptiveFeePctPerSide;
function getAdaptiveSetupMode() {
    const value = process.env.V3_ADAPTIVE_SETUP_MODE?.trim().toLowerCase();
    if (value === 'shadow' || value === 'live')
        return value;
    return 'off';
}
function isAdaptiveSetupShadowEnabled() {
    return getAdaptiveSetupMode() !== 'off';
}
function isAdaptiveSetupLiveEnabled() {
    return getAdaptiveSetupMode() === 'live';
}
function isEarlyStructureFlipEnabled() {
    return process.env.V3_EARLY_STRUCTURE_FLIP_ENABLED !== 'false';
}
function isAlignedMicroBosEnabled() {
    return process.env.V3_ALIGNED_MICRO_BOS_ENABLED !== 'false';
}
function isRangeSweepReclaimEnabled() {
    return process.env.V3_RANGE_SWEEP_RECLAIM_ENABLED !== 'false';
}
function isAlignedMicroBosRequire1hAlign() {
    return process.env.V3_ALIGNED_MICRO_BOS_REQUIRE_1H_ALIGN !== 'false';
}
function isRangeSweepLong5mOnly() {
    return process.env.V3_RANGE_SWEEP_LONG_5M_ONLY !== 'false';
}
function positiveNumber(key, fallback) {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
function getAdaptiveSetupTtlMinutes(kind) {
    if (kind === 'range_sweep_reclaim') {
        return positiveNumber('V3_RANGE_SWEEP_RETEST_TTL_MINUTES', 90);
    }
    return positiveNumber('V3_ADAPTIVE_RETEST_TTL_MINUTES', 180);
}
function getAdaptiveSetupRr(kind) {
    if (kind === 'range_sweep_reclaim') {
        return positiveNumber('V3_RANGE_SWEEP_RR', 2);
    }
    if (kind === 'aligned_micro_bos') {
        return positiveNumber('V3_ALIGNED_MICRO_BOS_RR', 3);
    }
    return positiveNumber('V3_EARLY_STRUCTURE_FLIP_RR', 3);
}
/** Fraction of the 1h range considered an edge (0.30 = outer 30%). */
function getRangeSweepEdgeFraction() {
    const value = positiveNumber('V3_RANGE_SWEEP_EDGE_FRACTION', 0.3);
    return Math.min(0.5, value);
}
function getAdaptiveMicroBosStrength() {
    const value = Math.floor(positiveNumber('V3_ADAPTIVE_MICRO_BOS_STRENGTH', 1));
    return Math.max(1, Math.min(3, value));
}
function isRangeSweepRetestBosRequired() {
    return process.env.V3_RANGE_SWEEP_RETEST_REQUIRE_BOS !== 'false';
}
function isRangeSweepTargetRoomRequired() {
    return process.env.V3_RANGE_SWEEP_REQUIRE_TARGET_ROOM === 'true';
}
function getAdaptiveFeePctPerSide() {
    return positiveNumber('V3_ADAPTIVE_FEE_PCT_PER_SIDE', 0.0004);
}
//# sourceMappingURL=adaptive-setup-policy.js.map