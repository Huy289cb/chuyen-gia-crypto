import type { SignalGateOutput } from '../services/signal-gate.service';
import { getV3TfPriorityRank } from '../config/v3-schedulers';

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

export function compareSignalGateEvaluations(
  a: { timeframe: string; result: SignalGateOutput },
  b: { timeframe: string; result: SignalGateOutput }
): number {
  if (a.result.pass !== b.result.pass) return a.result.pass ? -1 : 1;
  const ga = GRADE_RANK[a.result.setupResult.grade] ?? 9;
  const gb = GRADE_RANK[b.result.setupResult.grade] ?? 9;
  if (ga !== gb) return ga - gb;
  const confDiff = b.result.setupResult.confidence - a.result.setupResult.confidence;
  if (confDiff !== 0) return confDiff;
  const tfRank = getV3TfPriorityRank();
  return (tfRank[a.timeframe] ?? 9) - (tfRank[b.timeframe] ?? 9);
}
