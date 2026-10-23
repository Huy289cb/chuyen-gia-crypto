import { evaluateTrendPullbackEntry } from '../config/v3-entry-policy';

export interface PullbackEvaluationInput {
  side: 'long' | 'short'; entry: number; closes: number[];
  smaPeriod: number; maxAbovePct: number; maxBelowPct: number;
  enabled: boolean; tfLabel: string;
}

/** Same production gate, with fully resolved inputs for deterministic audit replay. */
export function evaluateRecordedPullback(input: PullbackEvaluationInput) {
  const resolved = { ...input, closes: input.closes.slice(-input.smaPeriod) };
  const result = evaluateTrendPullbackEntry(resolved);
  return {
    schema: 'pullback-evaluation-v1' as const,
    input: resolved,
    result,
    dataStatus: !resolved.enabled ? 'disabled' : result.sma === undefined ? 'unavailable' : 'known',
  };
}
