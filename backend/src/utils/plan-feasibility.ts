/** Measurement only. Fractions (0.008 = 0.8%) are explicit; never rewrites submitted levels. */
export interface PlanGeometry {
  side: 'long' | 'short'; entry: number; stopLoss: number; takeProfit?: number;
  targetBound?: number; minSlFraction: number; minRr: number;
}
export function measurePlanGeometry(p: PlanGeometry) {
  const blockers: string[] = [];
  const invalid = !['long', 'short'].includes(p.side) ||
    ![p.entry, p.stopLoss, p.minSlFraction, p.minRr].every(x => Number.isFinite(x) && x > 0);
  if (invalid) return { blockers: ['missing_data'], feasible: false, stopFraction: null,
    requiredTargetFraction: null, availableTargetFraction: null, rr: null };
  const dir = p.side === 'long' ? 1 : -1;
  const stopFraction = dir * (p.entry - p.stopLoss) / p.entry;
  if (stopFraction <= 0) blockers.push('invalid_levels');
  else if (stopFraction + 1e-12 < p.minSlFraction) blockers.push('stop_floor');
  const requiredTargetFraction = Math.max(p.minSlFraction, stopFraction) * p.minRr;
  const availableTargetFraction = p.targetBound != null && Number.isFinite(p.targetBound) && p.targetBound > 0
    ? dir * (p.targetBound - p.entry) / p.entry : null;
  if (availableTargetFraction === null) blockers.push('missing_target_bound');
  else if (availableTargetFraction + 1e-12 < requiredTargetFraction) blockers.push('target_room');
  const reward = p.takeProfit != null && Number.isFinite(p.takeProfit) && p.takeProfit > 0
    ? dir * (p.takeProfit - p.entry) / p.entry : null;
  const rr = reward !== null && stopFraction > 0 ? reward / stopFraction : null;
  if (p.takeProfit !== undefined) {
    if (rr === null || reward! <= 0) blockers.push('invalid_levels');
    else if (rr + 1e-9 < p.minRr) blockers.push('rr');
    if (reward !== null && availableTargetFraction !== null && reward > availableTargetFraction + 1e-12)
      blockers.push('target_bound_exceeded');
  }
  return { feasible: blockers.length === 0, blockers, stopFraction, requiredTargetFraction, availableTargetFraction, rr };
}

/**
 * Offline RR-variant admission: place TP at policy RR only when targetBound allows.
 * Never drags TP through/past targetBound — reject with target_room instead.
 * Live MIN_RR_RATIO must not call this path.
 */
export function evaluateBoundAwareRrVariant(input: {
  side: 'long' | 'short';
  entry: number;
  stopLoss: number;
  targetBound: number | null | undefined;
  minSlFraction: number;
  minRr: number;
}): {
  pass: boolean;
  reason: string;
  takeProfit: number | null;
  achievedRr: number | null;
  blockers: string[];
} {
  const dir = input.side === 'long' ? 1 : -1;
  const geo = measurePlanGeometry({
    side: input.side,
    entry: input.entry,
    stopLoss: input.stopLoss,
    targetBound: input.targetBound ?? undefined,
    minSlFraction: input.minSlFraction,
    minRr: input.minRr,
  });
  if (!geo.feasible) {
    return {
      pass: false,
      reason: geo.blockers[0] ?? 'blocked',
      takeProfit: null,
      achievedRr: null,
      blockers: geo.blockers,
    };
  }
  const risk = Math.abs(input.entry - input.stopLoss);
  const rawTp = input.entry + dir * risk * input.minRr;
  const takeProfit =
    input.side === 'long' ? Math.ceil(rawTp * 100) / 100 : Math.floor(rawTp * 100) / 100;
  // Bound already verified by measurePlanGeometry; TP stays at/inside bound by construction.
  const withTp = measurePlanGeometry({
    ...input,
    targetBound: input.targetBound ?? undefined,
    takeProfit,
  });
  return {
    pass: withTp.feasible,
    reason: withTp.feasible ? 'ok' : (withTp.blockers[0] ?? 'blocked'),
    takeProfit: withTp.feasible ? takeProfit : null,
    achievedRr: withTp.rr,
    blockers: withTp.blockers,
  };
}
