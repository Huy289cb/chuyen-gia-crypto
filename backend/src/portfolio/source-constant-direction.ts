import { Decimal } from '@prisma/client/runtime/library';
import type { DailyPriceRow, SourcePortfolioTargets } from './types';

/** Matches the registered source; the daily loss budget belongs to the policy, not the signal. */
export const CONSTANT_DIRECTION_SOURCE_REVISION = 'constant-direction-b5-vol90-s6-v1';
export const CONSTANT_DIRECTION_POLICY_ID = 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1';
export const CONSTANT_DIRECTION_SOURCE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'] as const;
export const CONSTANT_DIRECTION_HORIZONS = [5, 10, 20, 30, 60, 90, 150, 250, 360] as const;
const DAY = 86_400_000;
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export interface ConstantDirectionCoinMetadata {
  [key: string]: unknown;
  observedDailyBars: number;
  eligible360BarsAnd90Vol: true;
  annVol90: number;
  signedSignalCount: 9;
  signalStates: Record<string, number>;
  priorStopsTestedToday: Record<string, null>;
  nextStops: Record<string, null>;
  reasons: Record<string, string>;
  signalCountChanged: false;
  stateVectorChanged: false;
  baseDesiredSleeveWeight: number;
  scaledDesiredSleeveWeight: number;
  directionDefinition: string;
}

export interface ConstantDirectionSourcePortfolioTargets extends Omit<SourcePortfolioTargets, 'strategy' | 'metadata'> {
  strategy: 'constant-direction-b5-v1';
  policyId: typeof CONSTANT_DIRECTION_POLICY_ID;
  sourceRevision: typeof CONSTANT_DIRECTION_SOURCE_REVISION;
  originalSourceId: typeof CONSTANT_DIRECTION_SOURCE_REVISION;
  mode: 'constant_direction';
  sourceSizingScalar: 6;
  generatedSourceSizingScalar: 4;
  /** Scalar6 presentation only; execution uses decimalWeights. */
  weights: Record<string, number>;
  /** Unscaled JSON float bytes from the registered source4 generator. */
  raw4Weights: Record<string, number>;
  /** Exact source4 float string × .75 × 2 at Decimal40/HALF_EVEN. */
  decimalWeights: Record<string, string>;
  executionWeightsScalar6: Record<string, string>;
  baseDesiredWeights: Record<string, number>;
  metadata: Record<string, ConstantDirectionCoinMetadata>;
}

/**
 * Python3.10 statistics.stdev: sum exact binary ratios, round the variance to
 * float64, then sqrt. Kept independent of CCT direction, stops and reference NAV.
 */
function sampleDeviation(values: number[]): number {
  const view = new DataView(new ArrayBuffer(8));
  const parts = values.map(value => {
    view.setFloat64(0, value, false);
    const bits = view.getBigUint64(0, false), exponent = Number((bits >> 52n) & 2047n);
    const fraction = bits & ((1n << 52n) - 1n);
    return { n: (bits >> 63n ? -1n : 1n) * (exponent ? (1n << 52n) + fraction : fraction),
      e: exponent ? exponent - 1023 - 52 : -1074 };
  });
  const exponent = Math.min(...parts.filter(part => part.n !== 0n).map(part => part.e));
  if (!Number.isFinite(exponent)) return 0;
  let sum = 0n, squared = 0n;
  for (const part of parts) {
    if (part.n === 0n) continue;
    const n = part.n << BigInt(part.e - exponent);
    sum += n;
    squared += n * n;
  }
  const count = BigInt(values.length);
  const variance = new Money((count * squared - sum * sum).toString())
    .div((count * (count - 1n)).toString()).mul(new Money(2).pow(2 * exponent)).toNumber();
  return Math.sqrt(variance);
}

class CoinVolatility {
  private previousClose: number | null = null;
  private returns: number[] = [];
  private observedBars = 0;

  observe(close: number | null | undefined): void {
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) throw new Error('Selected constant-direction close must be finite and positive');
    if (this.previousClose !== null) {
      const change = close / this.previousClose - 1;
      if (!Number.isFinite(change)) throw new Error('Nonfinite constant-direction return');
      this.returns.push(change);
      if (this.returns.length > 90) this.returns.shift();
    }
    this.previousClose = close;
    this.observedBars++;
  }

  target(): ConstantDirectionCoinMetadata {
    const sigma = this.returns.length === 90 ? sampleDeviation(this.returns) * Math.sqrt(365) : 0;
    if (this.observedBars < 360 || !Number.isFinite(sigma) || sigma <= 0) throw new Error('Constant-direction target requires 360 observed bars and positive 90-return sample volatility');
    // Preserve the registered float operation order, including *9/9 rounding.
    const baseDesired = Math.min(.25 / sigma, 2) * 9 / 9;
    return {
      observedDailyBars: this.observedBars, eligible360BarsAnd90Vol: true, annVol90: sigma,
      signedSignalCount: 9,
      signalStates: Object.fromEntries(CONSTANT_DIRECTION_HORIZONS.map(n => [String(n), 1])),
      priorStopsTestedToday: Object.fromEntries(CONSTANT_DIRECTION_HORIZONS.map(n => [String(n), null])),
      nextStops: Object.fromEntries(CONSTANT_DIRECTION_HORIZONS.map(n => [String(n), null])),
      reasons: Object.fromEntries(CONSTANT_DIRECTION_HORIZONS.map(n => [String(n), 'constant_positive_direction_control'])),
      signalCountChanged: false, stateVectorChanged: false,
      baseDesiredSleeveWeight: baseDesired, scaledDesiredSleeveWeight: 4 * baseDesired,
      directionDefinition: 'forced +1 after warmup; no CCT stop/channel state',
    };
  }
}

/**
 * One closed UTC day becomes executable at the next UTC midnight. Only the
 * fixed B5 closes are observed; no CCT signal, count, stop or donor weight enters
 * this source. Preserve the complete seed so observed-bar eligibility is exact.
 */
export function buildConstantDirectionSourceTargetSeries(rows: DailyPriceRow[], window: {
  startTimeMs: number; endTimeMs: number;
}): ConstantDirectionSourcePortfolioTargets[] {
  const { startTimeMs, endTimeMs } = window;
  if (!Number.isSafeInteger(startTimeMs) || !Number.isSafeInteger(endTimeMs) || endTimeMs <= startTimeMs) throw new Error('Invalid constant-direction source window');
  const symbols = Object.keys(rows[0]?.closes ?? {});
  if (!CONSTANT_DIRECTION_SOURCE_SYMBOLS.every(symbol => symbols.includes(symbol))) throw new Error('Constant-direction source requires all fixed B5 symbols');
  const volatility = Object.fromEntries(CONSTANT_DIRECTION_SOURCE_SYMBOLS.map(symbol => [symbol, new CoinVolatility()]));
  const output: ConstantDirectionSourcePortfolioTargets[] = [];
  let previousTime: number | null = null;
  for (const row of rows) {
    const executeAtMs = row.openTimeMs + DAY;
    if (executeAtMs >= endTimeMs) break;
    if (!Number.isSafeInteger(row.openTimeMs) || row.openTimeMs % DAY !== 0) throw new Error('Invalid constant-direction UTC daily label');
    if (previousTime !== null && row.openTimeMs - previousTime !== DAY) throw new Error('Constant-direction history must be chronological, unique and consecutive UTC days');
    previousTime = row.openTimeMs;
    for (const symbol of CONSTANT_DIRECTION_SOURCE_SYMBOLS) volatility[symbol].observe(row.closes[symbol]);
    if (executeAtMs < startTimeMs) continue;
    const metadata = Object.fromEntries(CONSTANT_DIRECTION_SOURCE_SYMBOLS.map(symbol => [symbol, volatility[symbol].target()]));
    const weights: Record<string, number> = {}, raw4Weights: Record<string, number> = {};
    const decimalWeights: Record<string, string> = {}, baseDesiredWeights: Record<string, number> = {};
    for (const symbol of symbols) {
      const meta = metadata[symbol];
      const raw4 = meta ? meta.scaledDesiredSleeveWeight / 5 : 0;
      const exact = new Money(String(raw4)).mul('.75').mul(2);
      raw4Weights[symbol] = raw4;
      decimalWeights[symbol] = exact.isZero() ? '0' : exact.toString();
      weights[symbol] = exact.toNumber();
      baseDesiredWeights[symbol] = meta ? meta.baseDesiredSleeveWeight / 5 : 0;
    }
    output.push({
      strategy: 'constant-direction-b5-v1', policyId: CONSTANT_DIRECTION_POLICY_ID,
      sourceRevision: CONSTANT_DIRECTION_SOURCE_REVISION, originalSourceId: CONSTANT_DIRECTION_SOURCE_REVISION,
      sourceId: `${CONSTANT_DIRECTION_SOURCE_REVISION}:${executeAtMs}`, mode: 'constant_direction',
      sourceSizingScalar: 6, generatedSourceSizingScalar: 4,
      labelTimeMs: row.openTimeMs, knownAtMs: executeAtMs, executeAtMs,
      weights, raw4Weights, decimalWeights, executionWeightsScalar6: { ...decimalWeights }, baseDesiredWeights, metadata,
    });
  }
  const expectedStart = Math.ceil(startTimeMs / DAY) * DAY;
  const expectedCount = Math.max(0, Math.ceil((endTimeMs - expectedStart) / DAY));
  if (output.length !== expectedCount || output.some((row, i) => row.executeAtMs !== expectedStart + i * DAY)) throw new Error('Constant-direction history does not cover every scheduled UTC target');
  return output;
}

export function buildConstantDirectionSourceTargets(rows: DailyPriceRow[], executeAtMs: number): ConstantDirectionSourcePortfolioTargets {
  if (!Number.isSafeInteger(executeAtMs) || executeAtMs % DAY !== 0) throw new Error('Constant-direction execution must be exact UTC midnight');
  return buildConstantDirectionSourceTargetSeries(rows, { startTimeMs: executeAtMs, endTimeMs: executeAtMs + 1 })[0];
}
