/**
 * Apply profit-protect SL (breakeven / trail) on Binance + local DB.
 */

import {
  getBreakevenAtR,
  getBreakevenFeeBufferPct,
  getMinSlMovePct,
  getProfitProtectMinMinutes,
  getTimeStopHours,
  getTrailActivatePct,
  getTrailDistancePct,
  isProfitProtectEnabled,
} from '../config/profit-protect-policy';
import { computeProfitProtectSl } from '../utils/profit-protect-sl';
import { amendProtectiveStopLoss } from './amend-protective-sl.service';

/** Remember original risk distance so R multiples stay valid after BE move. */
const initialRiskByPosition = new Map<string, number>();

export function rememberInitialRisk(positionId: string, entry: number, stopLoss: number, side: string): number {
  const existing = initialRiskByPosition.get(positionId);
  if (existing != null && existing > 0) return existing;

  const localSide = side.toLowerCase() === 'short' ? 'short' : 'long';
  const risk =
    localSide === 'long'
      ? Math.max(0, entry - stopLoss)
      : Math.max(0, stopLoss - entry);
  if (risk > 0) {
    initialRiskByPosition.set(positionId, risk);
  }
  return risk;
}

export function getRememberedInitialRisk(positionId: string): number | undefined {
  return initialRiskByPosition.get(positionId);
}

export function clearProfitProtectState(positionId: string): void {
  initialRiskByPosition.delete(positionId);
}

export interface ProfitProtectPosition {
  position_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  stop_loss: number;
  size_qty: number;
  entry_time: Date;
  binance_sl_order_id?: string | null;
}

export async function maybeApplyProfitProtectSl(
  position: ProfitProtectPosition,
  mark: number
): Promise<{ applied: boolean; reason: string; newSl?: number }> {
  if (!isProfitProtectEnabled()) {
    return { applied: false, reason: 'profit protect disabled' };
  }
  if (process.env.BINANCE_ENABLED !== 'true') {
    return { applied: false, reason: 'binance disabled' };
  }

  const side = position.side.toLowerCase() === 'short' ? 'short' : 'long';
  const ageMinutes = (Date.now() - position.entry_time.getTime()) / 60_000;
  const initialRisk = rememberInitialRisk(
    position.position_id,
    position.entry_price,
    position.stop_loss,
    side
  );

  const plan = computeProfitProtectSl({
    side,
    entry: position.entry_price,
    mark,
    currentSl: position.stop_loss,
    initialRisk: initialRisk > 0 ? initialRisk : undefined,
    ageMinutes,
    beAtR: getBreakevenAtR(),
    trailActivatePct: getTrailActivatePct(),
    trailDistancePct: getTrailDistancePct(),
    minSlMovePct: getMinSlMovePct(),
    minAgeMinutes: getProfitProtectMinMinutes(),
    timeStopHours: getTimeStopHours(),
    beFeeBufferPct: getBreakevenFeeBufferPct(),
  });

  if (plan.action === 'none') {
    return { applied: false, reason: plan.reason };
  }

  const amended = await amendProtectiveStopLoss({
    position,
    newSl: plan.newSl,
    mark,
    eventType: 'profit_protect_sl',
    action: plan.action,
    reason: plan.reason,
    meta: {
      unrealized_pct: plan.unrealizedPct,
      r_multiple: plan.rMultiple,
    },
  });

  if (!amended.ok) {
    console.error(
      `[ProfitProtect] Failed to amend SL for ${position.position_id} @ ${plan.newSl}: ${amended.reason}`
    );
    return { applied: false, reason: amended.reason };
  }

  console.log(
    `[ProfitProtect] ${position.position_id} ${plan.action}: SL ${position.stop_loss}→${plan.newSl} ` +
      `(${plan.reason}) mark=${mark} uPnL=${plan.unrealizedPct.toFixed(2)}% ${plan.rMultiple.toFixed(2)}R`
  );

  return { applied: true, reason: plan.reason, newSl: plan.newSl };
}
