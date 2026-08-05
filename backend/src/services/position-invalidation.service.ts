/**
 * Structure invalidation → market exit when score≥min (green or red).
 * No BE tighten — profit-protect owns price-based BE/trail.
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
  isInvalidationExitEnabled,
} from '../config/position-invalidation-policy';
import { getBreakevenFeeBufferPct } from '../config/profit-protect-policy';
import { getScanResult } from '../schedulers/market-scan.scheduler';
import {
  evaluatePositionInvalidation,
  type InvalidationScanSnap,
} from '../utils/position-invalidation';
import { syncTestnetAccountFromBinance } from './binance-balance-sync.service';
import {
  closeLocalPosition,
  closePositionOnBinanceMarket,
} from './position-close.service';
import {
  getRememberedInitialRisk,
  rememberInitialRisk,
  type ProfitProtectPosition,
} from './profit-protect.service';
import { recordTestnetTradeEvent } from '../repositories/testnet.repository';

const lastAmendAt = new Map<string, number>();

export type InvalidationPosition = ProfitProtectPosition & {
  account_id: number;
  account: { current_balance: number };
  size_usd?: number;
  take_profit?: number;
  expected_rr?: number;
  risk_usd?: number;
  entry_fee?: number;
  binance_order_id?: string | null;
  binance_tp_order_id?: string | null;
  status?: string;
};

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
  position: InvalidationPosition,
  mark: number
): Promise<{
  applied: boolean;
  exited?: boolean;
  reason: string;
  newSl?: number;
  score?: number;
}> {
  if (!isInvalidationEnabled()) {
    return { applied: false, reason: 'invalidation disabled' };
  }
  if (process.env.BINANCE_ENABLED !== 'true') {
    return { applied: false, reason: 'binance disabled' };
  }

  const allowExit = isInvalidationExitEnabled();
  if (!allowExit) {
    return { applied: false, reason: 'invalidation exit disabled' };
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
    allowExitWhenRed: allowExit,
  });

  if (decision.action !== 'exit') {
    if (decision.score > 0) {
      console.log(
        `[Invalidation] ${position.position_id} hold score=${decision.score} — ${decision.reason}`
      );
    }
    return { applied: false, reason: decision.reason, score: decision.score };
  }

  const closeResult = await closePositionOnBinanceMarket(position, undefined, {
    guardSource: 'invalidation_exit',
    positionId: position.position_id,
    entryTime: position.entry_time ?? null,
  });
  if (!closeResult.ok) {
    console.error(
      `[Invalidation] Exit failed for ${position.position_id}: ${closeResult.reason}`
    );
    return { applied: false, reason: closeResult.reason ?? 'exit failed', score: decision.score };
  }

  await closeLocalPosition(
    { ...position, account: position.account },
    mark,
    'invalidation_exit',
    {
      score: decision.score,
      signals: decision.signals,
      unrealized_pct: decision.unrealizedPct,
      reason: decision.reason,
    }
  );
  await recordTestnetTradeEvent(position.position_id, 'position_invalidation', {
    action: 'exit',
    reason: decision.reason,
    score: decision.score,
    signals: decision.signals,
    unrealized_pct: decision.unrealizedPct,
    mark,
  });

  lastAmendAt.set(position.position_id, Date.now());
  try {
    await syncTestnetAccountFromBinance(position.account_id);
  } catch (syncErr: unknown) {
    const msg = syncErr instanceof Error ? syncErr.message : String(syncErr);
    console.warn(`[Invalidation] Balance sync after exit failed: ${msg}`);
  }

  console.log(
    `[Invalidation] ${position.position_id} EXIT @ ${mark} — ${decision.reason}`
  );
  return {
    applied: true,
    exited: true,
    reason: decision.reason,
    score: decision.score,
  };
}

/** Clear in-memory cooldown (tests). */
export function clearInvalidationCooldownState(): void {
  lastAmendAt.clear();
}
