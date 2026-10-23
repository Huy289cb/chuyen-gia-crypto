import type { DailyPriceRow, SourcePortfolioTargets } from './types';

export const SOURCE_MOMENTUM_REVISION = '104dc669084b7f0d0a99748a0f4300950b49930d';
export const SOURCE_UNIVERSE = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT',
  'AVAXUSDT','LINKUSDT','LTCUSDT','DOTUSDT','TRXUSDT','UNIUSDT','ATOMUSDT','ETCUSDT',
  'XLMUSDT','BCHUSDT','FILUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','INJUSDT',
  'SUIUSDT','AAVEUSDT','ICPUSDT','ALGOUSDT','SANDUSDT','GALAUSDT','GRTUSDT','1000PEPEUSDT',
  'WLDUSDT','SEIUSDT','TIAUSDT','RUNEUSDT','ENAUSDT','ORDIUSDT','DYDXUSDT','JUPUSDT','ZECUSDT',
] as const;
const DAY = 86_400_000;

/** pandas rank(method='average'), missing signals get zero weight, including warm-up. */
export function sourceRankWeights(signals: Record<string, number | null>): Record<string, number> {
  const available = Object.entries(signals).filter((x): x is [string, number] => x[1] !== null && !Number.isNaN(x[1]));
  available.sort((a, b) => a[1] - b[1]);
  const ranks: Record<string, number> = {};
  for (let i = 0; i < available.length;) {
    let j = i + 1;
    while (j < available.length && available[j][1] === available[i][1]) j++;
    for (let k = i; k < j; k++) ranks[available[k][0]] = (i + 1 + j) / 2;
    i = j;
  }
  const mean = available.length ? (available.length + 1) / 2 : 0;
  const absoluteSum = Object.values(ranks).reduce((sum, rank) => sum + Math.abs(rank - mean), 0);
  return Object.fromEntries(Object.keys(signals).map(symbol => [symbol, absoluteSum ? 2 * ((ranks[symbol] ?? mean) - mean) / absoluteSum : 0]));
}

/**
 * Source label t uses close[t-1], while its return is close[t] -> close[t+1].
 * Therefore execution at UTC t+1 uses prices only through t-1 (known at t).
 * Do not remove this extra day of lag when mapping daily open-label data to a broker.
 */
export function buildSourceTargets(rows: DailyPriceRow[], executeAtMs: number): SourcePortfolioTargets {
  if (!Number.isSafeInteger(executeAtMs) || executeAtMs % DAY !== 0) throw new Error('Source execution must be an exact UTC midnight');
  const labelTimeMs = executeAtMs - DAY;
  const latestLabel = labelTimeMs - DAY;
  const ordered = [...rows].sort((a, b) => a.openTimeMs - b.openTimeMs);
  const byTime = new Map<number, DailyPriceRow>();
  for (const row of ordered) {
    if (!Number.isSafeInteger(row.openTimeMs) || row.openTimeMs % DAY !== 0 || byTime.has(row.openTimeMs)) throw new Error('Invalid or duplicate daily price label');
    byTime.set(row.openTimeMs, row);
  }
  const signals: Record<string, number | null> = {};
  for (const symbol of SOURCE_UNIVERSE) {
    const latest = byTime.get(latestLabel)?.closes[symbol];
    const prior = byTime.get(latestLabel - 14 * DAY)?.closes[symbol];
    let last: number | null = null;
    // pandas pct_change defaults to forward fill; only complete 30-return windows count.
    const returns: number[] = [];
    for (let time = latestLabel - 31 * DAY; time <= latestLabel; time += DAY) {
      const observed = byTime.get(time)?.closes[symbol];
      const price: number | null = observed != null && Number.isFinite(observed) && observed > 0 ? observed : last;
      if (time >= latestLabel - 29 * DAY) {
        if (price === null || last === null) { returns.length = 0; break; }
        returns.push(price / last - 1);
      }
      last = price;
    }
    if (!(latest != null && prior != null && latest > 0 && prior > 0 && Number.isFinite(latest) && Number.isFinite(prior)) || returns.length !== 30) {
      signals[symbol] = null; continue;
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / 30;
    const sampleVol = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 29);
    const signal = (latest / prior - 1) / sampleVol;
    signals[symbol] = Number.isNaN(signal) ? null : signal;
  }
  return { weights: sourceRankWeights(signals), knownAtMs: labelTimeMs, executeAtMs, labelTimeMs,
    sourceId: `perp-quant-lab:${SOURCE_MOMENTUM_REVISION}:${labelTimeMs}` };
}
