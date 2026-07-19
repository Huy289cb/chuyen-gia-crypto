/**
 * Structure invalidation → tighten SL to BE when green (Phase A).
 * docs/position-invalidation-plan.md
 */

import {
  getInvalidationCooldownMs,
  getInvalidationHtfLostMinHours,
  getInvalidationHtfTf,
  getInvalidationLtfTf,
  getInvalidationMinMinutes,
  getInvalidationMinScore,
  getInvalidationMinUpnlPct,
  isInvalidationEnabled,
} from '../config/position-invalidation-policy';
import { getBreakevenFeeBufferPct, getMinSlMovePct } from '../config/profit-protect-policy';
import { getScanResult } from '../schedulers/market-scan.scheduler';
import {
  evaluatePositionInvalidation,
  type InvalidationScanSnap,
} from '../utils/position-invalidation';
import { amendProtectiveStopLoss } from './amend-protective-sl.service';
import {
  getRememberedInitialRisk,
  rememberInitialRisk,
  type ProfitProtectPosition,
} from './profit-protect.service';

const lastAmendAt = new Map<string, number>();

function toSnap(symbol: string, timeframe: string): InvalidationScanSnap | null {
  const scan = getScanResult(symbol, timeframe);
  if (!scan) return null;
  const setup = scan.signalResult.setupResult;
  const regimeEv = setup.evidence?.regime;
  return {
    timeframe,
    regime: setup.regime ?? regimeEv?.regime ?? 'unknown',
    trendDirection: regimeEv?.trendDirection ?? null,
    playbooks: setup.evidence?.playbooks?.map((pb) => ({
      playbook: pb.playbook,
      detected: pb.detected,
      grade: pb.grade,
      summary: pb.summary,
      metrics: pb.metrics,
    })),
  };
}

export async function maybeApplyInvalidationProtect(
  position: ProfitProtectPosition,
  mark: number
): Promise<{ applied: boolean; reason: string; newSl?: number; score?: number }> {
  if (!isInvalidationEnabled()) {
    return { applied: false, reason: 'invalidation disabled' };
  }
  if (process.env.BINANCE_ENABLED !== 'true') {
    return { applied: false, reason: 'binance disabled' };
  }
  if (!position.binance_sl_order_id) {
    return { applied: false, reason: 'no exchange SL id' };
  }

  const cooldownUntil = (lastAmendAt.get(position.position_id) ?? 0) + getInvalidationCooldownMs();
  if (Date.now() < cooldownUntil) {
    return { applied: false, reason: 'invalidation cooldown' };
  }

  const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
  const ageMinutes = (Date.now() - position.entry_time.getTime()) / 60_000;
  const initialRisk =
    getRememberedInitialRisk(position.position_id) ??
    rememberInitialRisk(position.position_id, position.entry_price, position.stop_loss, side);

  const htfTf = getInvalidationHtfTf();
  const ltfTf = getInvalidationLtfTf();
  const decision = evaluatePositionInvalidation({
    side,
    entry: position.entry_price,
    mark,
    currentSl: position.stop_loss,
    ageMinutes,
    initialRisk: initialRisk > 0 ? initialRisk : undefined,
    htf: toSnap(position.symbol, htfTf),
    ltf: toSnap(position.symbol, ltfTf),
    minScore: getInvalidationMinScore(),
    minAgeMinutes: getInvalidationMinMinutes(),
    minUpnlPct: getInvalidationMinUpnlPct(),
    htfLostMinHours: getInvalidationHtfLostMinHours(),
    beFeeBufferPct: getBreakevenFeeBufferPct(),
  });

  if (decision.action !== 'tighten_be' || decision.newSl == null) {
    if (decision.score > 0) {
      console.log(
        `[Invalidation] ${position.position_id} hold score=${decision.score} — ${decision.reason}`
      );
    }
    return { applied: false, reason: decision.reason, score: decision.score };
  }

  const minMove = position.entry_price * (getMinSlMovePct() / 100);
  if (Math.abs(decision.newSl - position.stop_loss) < minMove) {
    return { applied: false, reason: 'move below min SL bump', score: decision.score };
  }

  const amended = await amendProtectiveStopLoss({
    position,
    newSl: decision.newSl,
    mark,
    eventType: 'position_invalidation',
    action: 'tighten_be',
    reason: decision.reason,
    meta: {
      score: decision.score,
      signals: decision.signals,
      unrealized_pct: decision.unrealizedPct,
    },
  });

  if (!amended.ok) {
    console.error(
      `[Invalidation] Amend failed for ${position.position_id}: ${amended.reason}`
    );
    return { applied: false, reason: amended.reason, score: decision.score };
  }

  lastAmendAt.set(position.position_id, Date.now());
  console.log(
    `[Invalidation] ${position.position_id} tighten_be: SL ${position.stop_loss}→${decision.newSl} ` +
      `(${decision.reason}) uPnL=${decision.unrealizedPct.toFixed(2)}%`
  );

  return {
    applied: true,
    reason: decision.reason,
    newSl: decision.newSl,
    score: decision.score,
  };
}
