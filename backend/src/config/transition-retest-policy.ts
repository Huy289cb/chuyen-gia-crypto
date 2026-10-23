export type TransitionRetestMode = 'off' | 'shadow' | 'shadow_llm' | 'live';
export type TransitionRetestGrade = 'A' | 'B' | 'C' | 'D';

const GRADE_ORDER: readonly TransitionRetestGrade[] = ['A', 'B', 'C', 'D'];

export function getTransitionRetestMode(): TransitionRetestMode {
  const raw = process.env.V3_TRANSITION_RETEST_MODE?.trim().toLowerCase();
  if (raw === 'shadow' || raw === 'shadow_llm' || raw === 'live') return raw;
  return 'off';
}

export function isTransitionRetestShadowEnabled(): boolean {
  return getTransitionRetestMode() !== 'off';
}

/**
 * Directional bull/long and bear/short breakouts may be remembered when the
 * pullback check is their only remaining blocker. Transition setups remain
 * shadow-only regardless of this flag.
 */
export function isTrendBreakoutRetestEnabled(): boolean {
  return process.env.V3_TREND_BREAKOUT_RETEST_ENABLED !== 'false';
}

/**
 * Observe a transition only after price resolves one side of the mixed 4h
 * structure and the fresh HTF trend agrees. This path is deliberately
 * shadow-only until its own outcome sample has positive expectancy.
 */
export function isTransitionResolutionEnabled(): boolean {
  return process.env.V3_TRANSITION_RESOLUTION_ENABLED === 'true';
}

export function isTransitionRetestLlmEnabled(): boolean {
  const mode = getTransitionRetestMode();
  return mode === 'shadow_llm' || mode === 'live';
}

export function isTransitionRetestLiveEnabled(): boolean {
  return getTransitionRetestMode() === 'live';
}

/**
 * Minimum accepted quality. `B` means B-or-better, therefore both A and B.
 * V3_TRANSITION_RETEST_GRADES remains a backwards-compatible fallback; when
 * it contains a list, the lowest listed quality becomes the minimum.
 */
export function getTransitionRetestMinGrade(): TransitionRetestGrade {
  const raw =
    process.env.V3_TRANSITION_RETEST_MIN_GRADE?.trim() ||
    process.env.V3_TRANSITION_RETEST_GRADES?.trim() ||
    'B';
  const configured = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is TransitionRetestGrade =>
      GRADE_ORDER.includes(value as TransitionRetestGrade)
    );
  if (configured.length === 0) return 'B';
  return configured.reduce((minimum, grade) =>
    GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(minimum) ? grade : minimum
  );
}

export function getTransitionRetestGrades(): TransitionRetestGrade[] {
  const minimumIndex = GRADE_ORDER.indexOf(getTransitionRetestMinGrade());
  return GRADE_ORDER.slice(0, minimumIndex + 1);
}

export function isTransitionRetestGradeEligible(grade: string): boolean {
  return getTransitionRetestGrades().includes(
    grade.trim().toUpperCase() as TransitionRetestGrade
  );
}

function positiveNumber(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getTransitionRetestTtlMinutes(): number {
  return positiveNumber('V3_TRANSITION_RETEST_TTL_MINUTES', 45);
}

export function getTransitionResolutionTtlMinutes(): number {
  return positiveNumber('V3_TRANSITION_RESOLUTION_TTL_MINUTES', 180);
}

export function getTransitionRetestTolerancePct(): number {
  return positiveNumber('V3_TRANSITION_RETEST_TOLERANCE_PCT', 0.15);
}

export function getTransitionRetestInvalidationPct(): number {
  return positiveNumber('V3_TRANSITION_RETEST_INVALIDATION_PCT', 0.25);
}

export function getTransitionRetestRequireHtfTf(): string {
  return process.env.V3_TRANSITION_RETEST_REQUIRE_HTF_TF?.trim() || '1h';
}

export function isTransitionRetestBosRequired(): boolean {
  return process.env.V3_TRANSITION_RETEST_REQUIRE_BOS !== 'false';
}

export function getTransitionRetestMaxHoldHours(): number {
  return positiveNumber('V3_TRANSITION_RETEST_MAX_HOLD_HOURS', 48);
}
