/**
 * Pure SL tighten math for breakeven + trail (no I/O).
 */

import { feeAwareBreakevenSl } from './breakeven-sl';

export type ProfitProtectSide = 'long' | 'short';

export interface ProfitProtectInput {
  side: ProfitProtectSide;
  entry: number;
  mark: number;
  currentSl: number;
  /** Original planned risk distance; if omitted, inferred from |entry - currentSl| when currentSl is on risk side. */
  initialRisk?: number;
  ageMinutes: number;
  beAtR: number;
  trailActivatePct: number;
  trailDistancePct: number;
  minSlMovePct: number;
  minAgeMinutes: number;
  timeStopHours: number;
  /** Move BE into profit by this % of entry (fee cover). Default 0. */
  beFeeBufferPct?: number;
}

export interface ProfitProtectResult {
  action: 'none' | 'breakeven' | 'trail' | 'time_stop_be';
  newSl: number;
  reason: string;
  unrealizedPct: number;
  rMultiple: number;
}

function initialRiskDistance(side: ProfitProtectSide, entry: number, currentSl: number, initialRisk?: number): number {
  if (initialRisk != null && Number.isFinite(initialRisk) && initialRisk > 0) {
    return initialRisk;
  }
  if (side === 'long') {
    return entry > currentSl ? entry - currentSl : 0;
  }
  return currentSl > entry ? currentSl - entry : 0;
}

function isTighter(side: ProfitProtectSide, candidate: number, currentSl: number): boolean {
  return side === 'long' ? candidate > currentSl : candidate < currentSl;
}

function roundPrice(price: number): number {
  return Math.round(price * 100) / 100;
}

export function computeProfitProtectSl(input: ProfitProtectInput): ProfitProtectResult {
  const {
    side,
    entry,
    mark,
    currentSl,
    ageMinutes,
    beAtR,
    trailActivatePct,
    trailDistancePct,
    minSlMovePct,
    minAgeMinutes,
    timeStopHours,
    beFeeBufferPct = 0,
  } = input;

  const none = (reason: string, unrealizedPct: number, rMultiple: number): ProfitProtectResult => ({
    action: 'none',
    newSl: currentSl,
    reason,
    unrealizedPct,
    rMultiple,
  });

  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(mark) || mark <= 0) {
    return none('invalid prices', 0, 0);
  }
  if (!Number.isFinite(currentSl) || currentSl <= 0) {
    return none('invalid current SL', 0, 0);
  }

  const unrealizedPct =
    side === 'long' ? ((mark - entry) / entry) * 100 : ((entry - mark) / entry) * 100;
  const risk = initialRiskDistance(side, entry, currentSl, input.initialRisk);
  const rMultiple = risk > 0 ? (unrealizedPct / 100) * entry / risk : 0;

  if (ageMinutes < minAgeMinutes) {
    return none(`age ${ageMinutes.toFixed(0)}m < min ${minAgeMinutes}m`, unrealizedPct, rMultiple);
  }

  let candidate = currentSl;
  let action: ProfitProtectResult['action'] = 'none';
  let reason = 'no tighten';
  const beSl = feeAwareBreakevenSl(side, entry, beFeeBufferPct);

  // 1) Breakeven at ≥ N R
  if (beAtR > 0 && rMultiple >= beAtR) {
    if (isTighter(side, beSl, candidate)) {
      candidate = beSl;
      action = 'breakeven';
      reason = `breakeven+fee ${beFeeBufferPct}% at ${rMultiple.toFixed(2)}R (threshold ${beAtR}R)`;
    }
  }

  // 2) Time-stop BE: held long enough, still green, SL still below/above fee-aware BE
  if (timeStopHours > 0 && ageMinutes >= timeStopHours * 60 && unrealizedPct > 0) {
    if (isTighter(side, beSl, candidate)) {
      candidate = beSl;
      action = 'time_stop_be';
      reason = `time-stop BE+fee ${beFeeBufferPct}% after ${(ageMinutes / 60).toFixed(1)}h (uPnL ${unrealizedPct.toFixed(2)}%)`;
    }
  }

  // 3) Trail behind mark once activated
  if (trailActivatePct > 0 && unrealizedPct >= trailActivatePct && trailDistancePct > 0) {
    const trailSl =
      side === 'long'
        ? roundPrice(mark * (1 - trailDistancePct / 100))
        : roundPrice(mark * (1 + trailDistancePct / 100));
    // Trail must not loosen past entry if we already have BE (keep the tighter of BE vs trail)
    if (isTighter(side, trailSl, candidate)) {
      candidate = trailSl;
      action = 'trail';
      reason = `trail ${trailDistancePct}% behind mark (uPnL ${unrealizedPct.toFixed(2)}% ≥ ${trailActivatePct}%)`;
    }
  }

  if (action === 'none' || !isTighter(side, candidate, currentSl)) {
    return none(reason === 'no tighten' ? 'SL already protective enough' : reason, unrealizedPct, rMultiple);
  }

  const minMove = entry * (minSlMovePct / 100);
  const move = Math.abs(candidate - currentSl);
  if (move < minMove) {
    return none(
      `move ${move.toFixed(2)} < min ${minMove.toFixed(2)} (${minSlMovePct}% entry)`,
      unrealizedPct,
      rMultiple
    );
  }

  // Sanity: SL must stay on correct side of mark (otherwise stop would trigger immediately)
  if (side === 'long' && candidate >= mark) {
    return none(`candidate SL ${candidate} >= mark ${mark}`, unrealizedPct, rMultiple);
  }
  if (side === 'short' && candidate <= mark) {
    return none(`candidate SL ${candidate} <= mark ${mark}`, unrealizedPct, rMultiple);
  }

  return { action, newSl: candidate, reason, unrealizedPct, rMultiple };
}
