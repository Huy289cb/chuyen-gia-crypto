import type { SignalGateOutput } from '../services/signal-gate.service';

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
const TF_RANK: Record<string, number> = { '15m': 0, '1h': 1, '4h': 2 };

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
  return (TF_RANK[a.timeframe] ?? 9) - (TF_RANK[b.timeframe] ?? 9);
}
