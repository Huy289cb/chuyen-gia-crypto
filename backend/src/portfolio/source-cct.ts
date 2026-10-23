import { Decimal } from '@prisma/client/runtime/library';
import type { DailyPriceRow } from './types';
import type { CctCoinMetadata, CctSourcePortfolioTargets } from './cct-types';

export const CCT_SOURCE_REVISION = 'cct-lc-b5-source6-v1-24d8340d58f91e17';
export const CCT_SOURCE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'] as const;
export const CCT_HORIZONS = [5, 10, 20, 30, 60, 90, 150, 250, 360] as const;
const DAY = 86_400_000;
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
interface IndicatorState { direction: number; nextStop: number | null }

// Frozen Python3.10 statistics.stdev sums exact binary ratios, rounds variance
// to float64, then calls math.sqrt. Its two rounding steps are intentional.
function sampleDeviation(values: number[]): number {
  const view = new DataView(new ArrayBuffer(8));
  const parts = values.map(value => {
    view.setFloat64(0, value, false);
    const bits = view.getBigUint64(0, false), exponent = Number((bits >> 52n) & 2047n);
    const fraction = bits & ((1n << 52n) - 1n);
    return { n: (bits >> 63n ? -1n : 1n) * (exponent ? (1n << 52n) + fraction : fraction),
      e: exponent ? exponent - 1023 - 52 : -1074 };
  });
  const exponent = Math.min(...parts.filter(p => p.n !== 0n).map(p => p.e));
  if (!Number.isFinite(exponent)) return 0;
  let sum = 0n, squared = 0n;
  for (const part of parts) {
    if (part.n === 0n) continue;
    const n = part.n << BigInt(part.e - exponent);
    sum += n; squared += n * n;
  }
  const count = BigInt(values.length);
  const variance = new Money((count * squared - sum * sum).toString())
    .div((count * (count - 1n)).toString()).mul(new Money(2).pow(2 * exponent)).toNumber();
  return Math.sqrt(variance);
}

/** Full-history, path-dependent long/cash indicator; no wallet or account PnL. */
class CoinIndicators {
  private closes: number[] = [];
  private returns: number[] = [];
  private states = new Map<number, IndicatorState>(CCT_HORIZONS.map(n => [n, { direction: 0, nextStop: null }]));
  private previousClose: number | null = null;
  private previousCount = 0;
  private referenceWeight = 0;
  private observedBars = 0;

  observe(close: number): CctCoinMetadata {
    if (!Number.isFinite(close) || close <= 0) throw new Error('Selected CCT close must be finite and positive');
    const change = this.previousClose === null ? 0 : close / this.previousClose - 1;
    if (this.previousClose !== null) {
      this.returns.push(change);
      if (this.returns.length > 90) this.returns.shift();
    }
    this.closes.push(close);
    if (this.closes.length > 360) this.closes.shift();
    this.observedBars++;
    const oldVector = CCT_HORIZONS.map(n => this.states.get(n)!.direction);
    const priorStopsTestedToday: Record<string, number | null> = {};
    const reasons: Record<string, string> = {};
    for (const n of CCT_HORIZONS) {
      const old = this.states.get(n)!;
      priorStopsTestedToday[n] = old.nextStop;
      if (this.closes.length < n) { reasons[n] = 'insufficient_window'; continue; }
      const sample = this.closes.slice(-n);
      const upper = Math.max(...sample), lower = Math.min(...sample);
      const midpoint = (upper + lower) / 2;
      if (old.direction === 0) {
        this.states.set(n, close === upper ? { direction: 1, nextStop: midpoint } : { direction: 0, nextStop: null });
        reasons[n] = close === upper ? 'upper_breakout' : 'cash';
      } else if (close <= old.nextStop!) {
        this.states.set(n, { direction: 0, nextStop: null }); reasons[n] = 'long_stop';
      } else {
        this.states.set(n, { direction: 1, nextStop: Math.max(old.nextStop!, midpoint) }); reasons[n] = 'hold';
      }
    }
    const vector = CCT_HORIZONS.map(n => this.states.get(n)!.direction);
    const count = vector.reduce((sum, n) => sum + n, 0);
    let sigma: number | null = null;
    if (this.returns.length === 90) {
      sigma = sampleDeviation(this.returns) * Math.sqrt(365);
    }
    const eligible = this.observedBars >= 360 && sigma !== null && sigma > 0;
    const baseDesired = (eligible ? Math.min(.25 / sigma!, 2) : 0) * count / CCT_HORIZONS.length;
    const desired = 4 * baseDesired;
    const denominator = 1 + this.referenceWeight * change;
    if (denominator <= 0) throw new Error('CCT reference sleeve drift denominator nonpositive');
    const currentReference = this.referenceWeight * (1 + change) / denominator;
    const countChanged = count !== this.previousCount;
    let resize = countChanged || (currentReference === 0 ? desired !== 0 : Math.abs(desired - currentReference) / Math.abs(currentReference) > .2);
    let requested = resize ? desired : currentReference;
    if (!eligible) { requested = 0; resize = true; }
    this.referenceWeight = requested;
    this.previousCount = count;
    this.previousClose = close;
    return {
      observedDailyBars: this.observedBars, eligible360BarsAnd90Vol: eligible, annVol90: sigma,
      signedSignalCount: count,
      signalStates: Object.fromEntries(CCT_HORIZONS.map(n => [String(n), this.states.get(n)!.direction])),
      priorStopsTestedToday,
      nextStops: Object.fromEntries(CCT_HORIZONS.map(n => [String(n), this.states.get(n)!.nextStop])),
      reasons, signalCountChanged: countChanged,
      stateVectorChanged: vector.some((x, i) => x !== oldVector[i]),
      baseDesiredSleeveWeight: baseDesired, scaledDesiredSleeveWeight: desired,
      currentReferenceSleeveWeight: currentReference,
      referenceBandRequestedSleeveWeight: requested, referenceBandResize: resize,
    };
  }
}

/**
 * Seed with ALL available chronological history, not a fresh 360-row tail.
 * Each label's CLOSE is known at its next UTC OPEN and executes at that OPEN.
 * Future rows are never observed or validated as prices for an earlier target.
 */
export function buildCctSourceTargetSeries(rows: DailyPriceRow[], window: { startTimeMs: number; endTimeMs: number }): CctSourcePortfolioTargets[] {
  const { startTimeMs, endTimeMs } = window;
  if (!Number.isSafeInteger(startTimeMs) || !Number.isSafeInteger(endTimeMs) || endTimeMs <= startTimeMs) throw new Error('Invalid CCT source window');
  const indicators = Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, new CoinIndicators()]));
  const output: CctSourcePortfolioTargets[] = [];
  const symbols = Object.keys(rows[0]?.closes ?? {});
  if (!CCT_SOURCE_SYMBOLS.every(s => symbols.includes(s))) throw new Error('CCT source requires all fixed B5 symbols');
  let previousTime: number | null = null;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.openTimeMs) || row.openTimeMs % DAY !== 0) throw new Error('Invalid CCT UTC daily label');
    if (previousTime !== null && row.openTimeMs - previousTime !== DAY) throw new Error('CCT history must be chronological, unique and consecutive UTC days');
    previousTime = row.openTimeMs;
    const executeAtMs = row.openTimeMs + DAY;
    if (executeAtMs >= endTimeMs) break;
    const metadata: Record<string, CctCoinMetadata> = {};
    for (const s of CCT_SOURCE_SYMBOLS) metadata[s] = indicators[s].observe(row.closes[s] as number);
    if (executeAtMs < startTimeMs) continue;
    if (!CCT_SOURCE_SYMBOLS.every(s => metadata[s].eligible360BarsAnd90Vol)) throw new Error('CCT target requires 360 observed bars and positive 90-return sample volatility');
    const weights: Record<string, number> = {}, decimalWeights: Record<string, string> = {}, baseDesiredWeights: Record<string, number> = {}, referenceBandRequestedWeights: Record<string, number> = {};
    for (const s of symbols) {
      const meta = metadata[s];
      // Match frozen source4 float -> decimal-string × .75 × processor2.
      const exact = meta ? new Money(meta.scaledDesiredSleeveWeight / 5).mul('.75').mul(2) : new Money(0);
      weights[s] = exact.toNumber();
      decimalWeights[s] = exact.isZero() ? '0' : exact.toString();
      baseDesiredWeights[s] = meta ? meta.baseDesiredSleeveWeight / 5 : 0;
      referenceBandRequestedWeights[s] = meta ? meta.referenceBandRequestedSleeveWeight / 5 : 0;
    }
    output.push({ strategy: 'cct-lc-b5-v1', policyId: 'CCT_LC_B5_S6_BUFFER11_V1', mode: 'long_cash',
      sourceId: `${CCT_SOURCE_REVISION}:${executeAtMs}`, originalSourceId: 'cct-lc-fixed5-scalar4-v1-indicator',
      sourceSizingScalar: 6, generatedSourceSizingScalar: 4,
      labelTimeMs: row.openTimeMs, knownAtMs: executeAtMs, executeAtMs,
      weights, decimalWeights, baseDesiredWeights, referenceBandRequestedWeights, metadata });
  }
  const expectedStart = Math.ceil(startTimeMs / DAY) * DAY;
  const expectedCount = Math.max(0, Math.ceil((endTimeMs - expectedStart) / DAY));
  if (output.length !== expectedCount || output.some((r, i) => r.executeAtMs !== expectedStart + i * DAY)) throw new Error('CCT history does not cover every scheduled UTC target');
  return output;
}

export function buildCctSourceTargets(rows: DailyPriceRow[], executeAtMs: number): CctSourcePortfolioTargets {
  if (!Number.isSafeInteger(executeAtMs) || executeAtMs % DAY !== 0) throw new Error('CCT execution must be exact UTC midnight');
  return buildCctSourceTargetSeries(rows, { startTimeMs: executeAtMs, endTimeMs: executeAtMs + 1 })[0];
}
