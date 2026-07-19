/**
 * Breakeven SL slightly into profit so a stop fill covers fees.
 * Default ~0.08% ≈ futures round-trip taker on both legs.
 */

export type BeSide = 'long' | 'short';

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
