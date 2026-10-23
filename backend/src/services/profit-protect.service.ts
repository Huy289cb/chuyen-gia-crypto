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
  isCostAwareBreakevenEnabled,
} from '../config/profit-protect-policy';
import { computeProfitProtectSl } from '../utils/profit-protect-sl';
import { amendProtectiveStopLoss } from './amend-protective-sl.service';
import {cashBreakevenSl} from '../utils/breakeven-sl';
import {getRiskPolicy} from '../config/risk-policy';

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
  entry_fee?: number;
  funding_fee?: number;
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

  const costAware=isCostAwareBreakevenEnabled();
  const riskPolicy=getRiskPolicy(),quantity=Math.abs(position.size_qty);
  const feeFraction=riskPolicy.maxFeePercent/200;
  const entryReserve=Math.max(Number(position.entry_fee??0),position.entry_price*quantity*feeFraction);
  const fundingReserve=Math.max(0,Number(position.funding_fee??0));
  const supportedSymbol=position.symbol.toUpperCase().replace(/USDT$/,'')==='BTC';
  const cashSl=supportedSymbol?cashBreakevenSl({side,entry:position.entry_price,quantity,entryCostsUsd:entryReserve,
    fundingPaidUsd:fundingReserve,exitFeeFraction:feeFraction,exitSlippageFraction:riskPolicy.maxSlippagePercent/100,tickSize:.1}):null;
  if(costAware&&cashSl===null)return {applied:false,reason:'cash breakeven cost inputs unavailable'};

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
    cashBreakevenSl:costAware?cashSl!:undefined,
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
      cash_breakeven_enabled:costAware,
      cash_breakeven_sl:cashSl,
      entry_cost_reserve_usd:entryReserve,
      funding_reserve_usd:fundingReserve,
      exit_fee_fraction:feeFraction,
      exit_slippage_reserve_fraction:riskPolicy.maxSlippagePercent/100,
      estimated_net_at_stop_usd:supportedSymbol?(side==='long'?1:-1)*(plan.newSl-position.entry_price)*quantity-entryReserve-fundingReserve-
        plan.newSl*quantity*feeFraction-position.entry_price*quantity*riskPolicy.maxSlippagePercent/100:null,
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
