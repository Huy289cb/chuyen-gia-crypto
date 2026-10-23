"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransitionRetestMode = getTransitionRetestMode;
exports.isTransitionRetestShadowEnabled = isTransitionRetestShadowEnabled;
exports.isTrendBreakoutRetestEnabled = isTrendBreakoutRetestEnabled;
exports.isTransitionResolutionEnabled = isTransitionResolutionEnabled;
exports.isTransitionRetestLlmEnabled = isTransitionRetestLlmEnabled;
exports.isTransitionRetestLiveEnabled = isTransitionRetestLiveEnabled;
exports.getTransitionRetestMinGrade = getTransitionRetestMinGrade;
exports.getTransitionRetestGrades = getTransitionRetestGrades;
exports.isTransitionRetestGradeEligible = isTransitionRetestGradeEligible;
exports.getTransitionRetestTtlMinutes = getTransitionRetestTtlMinutes;
exports.getTransitionResolutionTtlMinutes = getTransitionResolutionTtlMinutes;
exports.getTransitionRetestTolerancePct = getTransitionRetestTolerancePct;
exports.getTransitionRetestInvalidationPct = getTransitionRetestInvalidationPct;
exports.getTransitionRetestRequireHtfTf = getTransitionRetestRequireHtfTf;
exports.isTransitionRetestBosRequired = isTransitionRetestBosRequired;
exports.getTransitionRetestMaxHoldHours = getTransitionRetestMaxHoldHours;
const GRADE_ORDER = ['A', 'B', 'C', 'D'];
function getTransitionRetestMode() {
    const raw = process.env.V3_TRANSITION_RETEST_MODE?.trim().toLowerCase();
    if (raw === 'shadow' || raw === 'shadow_llm' || raw === 'live')
        return raw;
    return 'off';
}
function isTransitionRetestShadowEnabled() {
    return getTransitionRetestMode() !== 'off';
}
/**
 * Directional bull/long and bear/short breakouts may be remembered when the
 * pullback check is their only remaining blocker. Transition setups remain
 * shadow-only regardless of this flag.
 */
function isTrendBreakoutRetestEnabled() {
    return process.env.V3_TREND_BREAKOUT_RETEST_ENABLED !== 'false';
}
/**
 * Observe a transition only after price resolves one side of the mixed 4h
 * structure and the fresh HTF trend agrees. This path is deliberately
 * shadow-only until its own outcome sample has positive expectancy.
 */
function isTransitionResolutionEnabled() {
    return process.env.V3_TRANSITION_RESOLUTION_ENABLED === 'true';
}
function isTransitionRetestLlmEnabled() {
    const mode = getTransitionRetestMode();
    return mode === 'shadow_llm' || mode === 'live';
}
function isTransitionRetestLiveEnabled() {
    return getTransitionRetestMode() === 'live';
}
/**
 * Minimum accepted quality. `B` means B-or-better, therefore both A and B.
 * V3_TRANSITION_RETEST_GRADES remains a backwards-compatible fallback; when
 * it contains a list, the lowest listed quality becomes the minimum.
 */
function getTransitionRetestMinGrade() {
    const raw = process.env.V3_TRANSITION_RETEST_MIN_GRADE?.trim() ||
        process.env.V3_TRANSITION_RETEST_GRADES?.trim() ||
        'B';
    const configured = raw
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter((value) => GRADE_ORDER.includes(value));
    if (configured.length === 0)
        return 'B';
    return configured.reduce((minimum, grade) => GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(minimum) ? grade : minimum);
}
function getTransitionRetestGrades() {
    const minimumIndex = GRADE_ORDER.indexOf(getTransitionRetestMinGrade());
    return GRADE_ORDER.slice(0, minimumIndex + 1);
}
function isTransitionRetestGradeEligible(grade) {
    return getTransitionRetestGrades().includes(grade.trim().toUpperCase());
}
function positiveNumber(key, fallback) {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
function getTransitionRetestTtlMinutes() {
    return positiveNumber('V3_TRANSITION_RETEST_TTL_MINUTES', 45);
}
function getTransitionResolutionTtlMinutes() {
    return positiveNumber('V3_TRANSITION_RESOLUTION_TTL_MINUTES', 180);
}
function getTransitionRetestTolerancePct() {
    return positiveNumber('V3_TRANSITION_RETEST_TOLERANCE_PCT', 0.15);
}
function getTransitionRetestInvalidationPct() {
    return positiveNumber('V3_TRANSITION_RETEST_INVALIDATION_PCT', 0.25);
}
function getTransitionRetestRequireHtfTf() {
    return process.env.V3_TRANSITION_RETEST_REQUIRE_HTF_TF?.trim() || '1h';
}
function isTransitionRetestBosRequired() {
    return process.env.V3_TRANSITION_RETEST_REQUIRE_BOS !== 'false';
}
function getTransitionRetestMaxHoldHours() {
    return positiveNumber('V3_TRANSITION_RETEST_MAX_HOLD_HOURS', 48);
}
//# sourceMappingURL=transition-retest-policy.js.map