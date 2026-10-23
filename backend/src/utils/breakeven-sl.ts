/**
 * Breakeven SL slightly into profit so a stop fill covers fees.
 * A fixed buffer is not proof of net breakeven; use cashBreakevenSl when costs are known.
 */

export type BeSide = 'long' | 'short';

/** Cash breakeven including accrued costs and an exit reserve; gaps/future funding remain uncertain. */
export function cashBreakevenSl(input: {
  side: BeSide; entry: number; quantity: number; entryCostsUsd: number; fundingPaidUsd: number;
  exitFeeFraction: number; exitSlippageFraction: number; tickSize: number;
}): number | null {
  const {side,entry,quantity,entryCostsUsd,fundingPaidUsd,exitFeeFraction,exitSlippageFraction,tickSize}=input;
  if(!['long','short'].includes(side)||![entry,quantity,tickSize].every(v=>Number.isFinite(v)&&v>0)||
    ![entryCostsUsd,exitFeeFraction,exitSlippageFraction].every(v=>Number.isFinite(v)&&v>=0)||
    !Number.isFinite(fundingPaidUsd)||exitFeeFraction>=1)return null;
  const d=side==='long'?1:-1;
  const raw=(d*entry*quantity+entryCostsUsd+fundingPaidUsd+entry*quantity*exitSlippageFraction)/(quantity*(d-exitFeeFraction));
  // Favorable rounding + one tick protects against the order layer rounding to nearest tick.
  const ticks=side==='long'?Math.ceil(raw/tickSize)+1:Math.floor(raw/tickSize)-1;
  const result=Number((ticks*tickSize).toPrecision(14));
  return result>0&&Number.isFinite(result)?result:null;
}

export function feeAwareBreakevenSl(
  side: BeSide,
  entry: number,
  feeBufferPct: number
): number {
  if (!(entry > 0) || !Number.isFinite(entry)) return entry;
  const buf = Math.max(0, feeBufferPct) / 100;
  const raw = side === 'long' ? entry * (1 + buf) : entry * (1 - buf);
  return Math.round(raw * 100) / 100;
}
