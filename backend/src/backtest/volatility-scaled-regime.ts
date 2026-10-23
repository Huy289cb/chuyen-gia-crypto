/** Research-only regime classifier; thresholds frozen before comparative outcomes. */
import {computeRegimeEvidence} from '../analyzers/market-regime.analyzer';
import {getSignalGateWindows} from '../config/signal-gate-windows';
import type {CandleData} from '../analyzers/setup-gate.analyzer';
import type {RegimeEvidence} from '../analyzers/setup-gate.types';
export const VOLATILITY_SCALED_RULES=Object.freeze({efficiencyMin:.3,netMoveAtrMin:2,atrBars:14});
export function volatilityScaledRegime(candles:CandleData[],timeframe:string):RegimeEvidence {
  const n=getSignalGateWindows(timeframe).regimeBars;
  const baseline=computeRegimeEvidence(candles,{regimeBars:n,timeframe});
  const rows=candles.slice(-n);
  if(rows.length<50)return baseline;
  let path=0;for(let i=1;i<rows.length;i++)path+=Math.abs(rows[i].close-rows[i-1].close);
  const move=Math.abs(rows.at(-1)!.close-rows[0].close),efficiency=path>0?move/path:0;
  let atr=0;
  for(let i=rows.length-14;i<rows.length;i++)atr+=Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close));
  atr/=14;
  const moveAtr=atr>0?move/atr:0;
  const trend=efficiency>=VOLATILITY_SCALED_RULES.efficiencyMin&&moveAtr>=VOLATILITY_SCALED_RULES.netMoveAtrMin;
  return {...baseline,regime:trend?'trend':'range',matchedRule:`research efficiency=${efficiency.toFixed(4)} net_move_atr=${moveAtr.toFixed(4)}; ER>=0.3 and displacement>=2ATR`};
}
