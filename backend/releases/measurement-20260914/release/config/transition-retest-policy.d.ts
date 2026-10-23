export type TransitionRetestMode = 'off' | 'shadow' | 'shadow_llm' | 'live';
export type TransitionRetestGrade = 'A' | 'B' | 'C' | 'D';
export declare function getTransitionRetestMode(): TransitionRetestMode;
export declare function isTransitionRetestShadowEnabled(): boolean;
/**
 * Directional bull/long and bear/short breakouts may be remembered when the
 * pullback check is their only remaining blocker. Transition setups remain
 * shadow-only regardless of this flag.
 */
export declare function isTrendBreakoutRetestEnabled(): boolean;
/**
 * Observe a transition only after price resolves one side of the mixed 4h
 * structure and the fresh HTF trend agrees. This path is deliberately
 * shadow-only until its own outcome sample has positive expectancy.
 */
export declare function isTransitionResolutionEnabled(): boolean;
export declare function isTransitionRetestLlmEnabled(): boolean;
export declare function isTransitionRetestLiveEnabled(): boolean;
/**
 * Minimum accepted quality. `B` means B-or-better, therefore both A and B.
 * V3_TRANSITION_RETEST_GRADES remains a backwards-compatible fallback; when
 * it contains a list, the lowest listed quality becomes the minimum.
 */
export declare function getTransitionRetestMinGrade(): TransitionRetestGrade;
export declare function getTransitionRetestGrades(): TransitionRetestGrade[];
export declare function isTransitionRetestGradeEligible(grade: string): boolean;
export declare function getTransitionRetestTtlMinutes(): number;
export declare function getTransitionResolutionTtlMinutes(): number;
export declare function getTransitionRetestTolerancePct(): number;
export declare function getTransitionRetestInvalidationPct(): number;
export declare function getTransitionRetestRequireHtfTf(): string;
export declare function isTransitionRetestBosRequired(): boolean;
export declare function getTransitionRetestMaxHoldHours(): number;
//# sourceMappingURL=transition-retest-policy.d.ts.map