import type { BacktestCandle } from '../backtest/types';
import type { StructureBias } from './structure-bias';

export interface RangeEdgeSetup {
  side: 'long' | 'short'; rangeLow: number; rangeHigh: number;
  structuralStop: number; target: number; entryZoneLimit: number;
}

/** Research prototype: directional rejection of an established range edge, without requiring a fresh sweep. */
export function detectRangeEdgeRejection(input: {
  local: BacktestCandle[]; hourly: BacktestCandle[]; hourlyRegime: string; macroBias: StructureBias;
}): RangeEdgeSetup | null {
  if (input.hourlyRegime !== 'range' || input.hourly.length < 25 || input.local.length < 2) return null;
  // Exclude the latest hourly candle from level construction, even though all inputs are closed.
  const box = input.hourly.slice(-25, -1);
  const low = Math.min(...box.map(c => c.low)), high = Math.max(...box.map(c => c.high));
  const width = high-low;
  if (!(low > 0 && width > 0)) return null;
  const widthFraction = width / ((high+low)/2);
  if (widthFraction < .016 || widthFraction > .04) return null;
  const lowTouches = box.filter(c => c.low <= low + width*.2).length;
  const highTouches = box.filter(c => c.high >= high - width*.2).length;
  if (lowTouches < 2 || highTouches < 2) return null;
  const candle=input.local.at(-1)!, prior=input.local.at(-2)!;
  if (input.macroBias !== 'bear' && candle.low <= low+width*.1 &&
      candle.close > low+width*.1 && candle.close <= low+width*.2 &&
      candle.close > candle.open && candle.close > prior.close) {
    return {side:'long',rangeLow:low,rangeHigh:high,structuralStop:low-width*.05,
      target:low+width*.8,entryZoneLimit:low+width*.2};
  }
  if (input.macroBias !== 'bull' && candle.high >= high-width*.1 &&
      candle.close < high-width*.1 && candle.close >= high-width*.2 &&
      candle.close < candle.open && candle.close < prior.close) {
    return {side:'short',rangeLow:low,rangeHigh:high,structuralStop:high+width*.05,
      target:high-width*.8,entryZoneLimit:high-width*.2};
  }
  return null;
}

/** Preserve structural target and stop; reject a poor next-bar price rather than stretching targets. */
export function rangeEdgeLevels(setup: RangeEdgeSetup, entry: number, minStopFraction=.008) {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (setup.side==='long' ? entry>setup.entryZoneLimit || entry<=setup.rangeLow :
      entry<setup.entryZoneLimit || entry>=setup.rangeHigh) return null;
  const stop=setup.side==='long' ? Math.min(setup.structuralStop,entry*(1-minStopFraction)) :
    Math.max(setup.structuralStop,entry*(1+minStopFraction));
  const reward=setup.side==='long' ? setup.target-entry : entry-setup.target;
  const risk=Math.abs(entry-stop);
  if (!(risk>0 && reward/risk>=1.5)) return null;
  return {stopLoss:stop,takeProfit:setup.target,rr:reward/risk};
}
