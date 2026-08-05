import type { SignalGateOutput } from '../services/signal-gate.service';
import { getV3EntryTfPriorityRank, getV3TfPriorityRank } from '../config/v3-schedulers';

const GRADE_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
/** Lower = preferred. LS over breakout when grade+conf tie. */
const PLAYBOOK_RANK: Record<string, number> = {
  liquidity_sweep_reclaim: 0,
  breakout_volume: 1,
};

function playbookRank(key: string | null | undefined): number {
  if (!key) return 9;
  return PLAYBOOK_RANK[key] ?? 5;
}

function compareSignalGateEvaluationsWithRank(
  a: { timeframe: string; result: SignalGateOutput },
  b: { timeframe: string; result: SignalGateOutput },
  tfRank: Record<string, number>
): number {
  if (a.result.pass !== b.result.pass) return a.result.pass ? -1 : 1;
  const ga = GRADE_RANK[a.result.setupResult.grade] ?? 9;
  const gb = GRADE_RANK[b.result.setupResult.grade] ?? 9;
  if (ga !== gb) return ga - gb;
  const confDiff = b.result.setupResult.confidence - a.result.setupResult.confidence;
  if (confDiff !== 0) return confDiff;
  const pb =
    playbookRank(a.result.setupResult.playbookKey) - playbookRank(b.result.setupResult.playbookKey);
  if (pb !== 0) return pb;
  return (tfRank[a.timeframe] ?? 9) - (tfRank[b.timeframe] ?? 9);
}

/** Dashboard / display — higher grade first, then TF priority. */
export function compareSignalGateEvaluations(
  a: { timeframe: string; result: SignalGateOutput },
  b: { timeframe: string; result: SignalGateOutput }
): number {
  return compareSignalGateEvaluationsWithRank(a, b, getV3TfPriorityRank());
}

/** LLM entry — prefer 15m structure when multiple TFs pass. */
export function compareSignalGateForEntry(
  a: { timeframe: string; result: SignalGateOutput },
  b: { timeframe: string; result: SignalGateOutput }
): number {
  return compareSignalGateEvaluationsWithRank(a, b, getV3EntryTfPriorityRank());
}
