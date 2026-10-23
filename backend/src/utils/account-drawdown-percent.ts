export function calcDrawdownPercent(peakEquity: number, currentEquity: number): number {
  if (!(peakEquity > 0) || currentEquity >= peakEquity) return 0;
  return ((peakEquity - currentEquity) / peakEquity) * 100;
}
