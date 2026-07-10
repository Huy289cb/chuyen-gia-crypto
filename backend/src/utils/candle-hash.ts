/**
 * Deterministic candle-bar identity for signal cache and trade_decisions dedup.
 */

export interface CandleHashInput {
  timestamp: number | Date;
  high: number;
  low: number;
  close: number;
}

export function generateCandleHash(candles: CandleHashInput[]): string {
  if (!candles.length) {
    return 'empty';
  }
  const last = candles[candles.length - 1];
  const ts =
    last.timestamp instanceof Date ? last.timestamp.getTime() : Number(last.timestamp);
  return `${ts}_${last.high}_${last.low}_${last.close}`;
}
