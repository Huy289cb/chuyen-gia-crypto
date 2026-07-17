/**
 * Pure position invalidation scoring (no I/O).
 * docs/position-invalidation-plan.md §5
 */

export type InvalidationSide = 'long' | 'short';

export interface InvalidationScanSnap {
  timeframe: string;
  regime: 'trend' | 'range' | 'chop' | string;
  trendDirection?: 'bullish' | 'bearish' | null;
  /** Playbook evidence rows from setup gate. */
  playbooks?: Array<{
    playbook: string;
    detected: boolean;
    grade: string;
    summary?: string;
    metrics?: Record<string, string | number | boolean | null>;
  }>;
}

export interface InvalidationInput {
  side: InvalidationSide;
  entry: number;
  mark: number;
  currentSl: number;
  ageMinutes: number;
  initialRisk?: number;
  htf?: InvalidationScanSnap | null;
  ltf?: InvalidationScanSnap | null;
  minScore: number;
  minAgeMinutes: number;
  minUpnlPct: number;
  htfLostMinHours: number;
}

export interface InvalidationSignal {
  id: string;
  weight: number;
  detail: string;
}

export interface InvalidationResult {
  action: 'hold' | 'tighten_be';
  score: number;
  signals: InvalidationSignal[];
  reason: string;
  unrealizedPct: number;
  newSl?: number;
}

function unrealizedPct(side: InvalidationSide, entry: number, mark: number): number {
  if (side === 'long') return ((mark - entry) / entry) * 100;
  return ((entry - mark) / entry) * 100;
}

function isTighter(side: InvalidationSide, candidate: number, currentSl: number): boolean {
  return side === 'long' ? candidate > currentSl : candidate < currentSl;
}

function gradeRank(g: string): number {
  if (g === 'A') return 3;
  if (g === 'B') return 2;
  if (g === 'C') return 1;
  return 0;
}

function adverseSweep(side: InvalidationSide, snap: InvalidationScanSnap | null | undefined): InvalidationSignal | null {
  if (!snap?.playbooks) return null;
  for (const pb of snap.playbooks) {
    if (pb.playbook !== 'liquidity_sweep' || !pb.detected || gradeRank(pb.grade) < 2) continue;
    const high = pb.metrics?.highSweep === true;
    const low = pb.metrics?.lowSweep === true;
    if (side === 'long' && high) {
      return {
        id: 'adverse_sweep',
        weight: 2,
        detail: `${snap.timeframe} high-sweep ${pb.grade}`,
      };
    }
    if (side === 'short' && low) {
      return {
        id: 'adverse_sweep',
        weight: 2,
        detail: `${snap.timeframe} low-sweep ${pb.grade}`,
      };
    }
  }
  return null;
}

function adverseBreakout(side: InvalidationSide, snap: InvalidationScanSnap | null | undefined): InvalidationSignal | null {
  if (!snap?.playbooks) return null;
  for (const pb of snap.playbooks) {
    if (pb.playbook !== 'breakout_volume' || !pb.detected || gradeRank(pb.grade) < 2) continue;
    const summary = String(pb.summary ?? '');
    const bullish = summary.includes('Break up') || summary.toLowerCase().includes('bullish');
    const bearish = summary.includes('Break down') || summary.toLowerCase().includes('bearish');
    if (side === 'long' && bearish) {
      return { id: 'adverse_breakout', weight: 1, detail: `${snap.timeframe} bearish breakout ${pb.grade}` };
    }
    if (side === 'short' && bullish) {
      return { id: 'adverse_breakout', weight: 1, detail: `${snap.timeframe} bullish breakout ${pb.grade}` };
    }
  }
  return null;
}

export function evaluatePositionInvalidation(input: InvalidationInput): InvalidationResult {
  const {
    side,
    entry,
    mark,
    currentSl,
    ageMinutes,
    initialRisk,
    htf,
    ltf,
    minScore,
    minAgeMinutes,
    minUpnlPct,
    htfLostMinHours,
  } = input;

  const uPct = unrealizedPct(side, entry, mark);
  const hold = (reason: string, signals: InvalidationSignal[] = [], score = 0): InvalidationResult => ({
    action: 'hold',
    score,
    signals,
    reason,
    unrealizedPct: uPct,
  });

  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(mark) || mark <= 0) {
    return hold('invalid prices');
  }
  if (ageMinutes < minAgeMinutes) {
    return hold(`age ${ageMinutes.toFixed(0)}m < min ${minAgeMinutes}m`);
  }

  const signals: InvalidationSignal[] = [];

  if (htf?.regime === 'chop') {
    signals.push({ id: 'htf_chop', weight: 2, detail: `${htf.timeframe} chop` });
  }

  if (htf?.regime === 'trend' && htf.trendDirection) {
    const against =
      (side === 'long' && htf.trendDirection === 'bearish') ||
      (side === 'short' && htf.trendDirection === 'bullish');
    if (against) {
      signals.push({
        id: 'htf_trend_against',
        weight: 2,
        detail: `${htf.timeframe} trend ${htf.trendDirection}`,
      });
    }
  }

  if (htf && (htf.regime === 'range' || htf.regime === 'chop') && ageMinutes >= htfLostMinHours * 60) {
    const risk = initialRisk != null && initialRisk > 0 ? initialRisk : Math.abs(entry - currentSl);
    const halfRPct = risk > 0 ? ((0.5 * risk) / entry) * 100 : 0;
    if (uPct < halfRPct) {
      signals.push({
        id: 'htf_lost_trend',
        weight: 1,
        detail: `${htf.timeframe} ${htf.regime} after ${htfLostMinHours}h uPnL ${uPct.toFixed(2)}%<${halfRPct.toFixed(2)}%`,
      });
    }
  }

  const sweepHtf = adverseSweep(side, htf);
  const sweepLtf = adverseSweep(side, ltf);
  if (sweepHtf) signals.push(sweepHtf);
  else if (sweepLtf) signals.push(sweepLtf);

  const brkHtf = adverseBreakout(side, htf);
  const brkLtf = adverseBreakout(side, ltf);
  if (brkHtf) signals.push(brkHtf);
  else if (brkLtf) signals.push(brkLtf);

  // Deduplicate by id keeping max weight
  const byId = new Map<string, InvalidationSignal>();
  for (const s of signals) {
    const prev = byId.get(s.id);
    if (!prev || s.weight > prev.weight) byId.set(s.id, s);
  }
  const uniq = [...byId.values()];
  const score = uniq.reduce((a, s) => a + s.weight, 0);

  if (score < minScore) {
    return hold(
      score === 0 ? 'no invalidation signals' : `score ${score} < min ${minScore}`,
      uniq,
      score
    );
  }

  if (uPct < minUpnlPct) {
    return hold(
      `score ${score} but uPnL ${uPct.toFixed(2)}% < min ${minUpnlPct}% — log only`,
      uniq,
      score
    );
  }

  const beSl = Math.round(entry * 100) / 100;
  if (!isTighter(side, beSl, currentSl)) {
    return hold(`score ${score} but SL already ≥ BE`, uniq, score);
  }
  if (side === 'long' && beSl >= mark) {
    return hold(`score ${score} but BE would trigger immediately`, uniq, score);
  }
  if (side === 'short' && beSl <= mark) {
    return hold(`score ${score} but BE would trigger immediately`, uniq, score);
  }

  return {
    action: 'tighten_be',
    score,
    signals: uniq,
    reason: `invalidation score ${score}: ${uniq.map((s) => s.id).join('+')}`,
    unrealizedPct: uPct,
    newSl: beSl,
  };
}
