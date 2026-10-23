import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';
import {
  buildConstantDirectionSourceTargets, buildConstantDirectionSourceTargetSeries,
  CONSTANT_DIRECTION_POLICY_ID, CONSTANT_DIRECTION_SOURCE_REVISION, CONSTANT_DIRECTION_SOURCE_SYMBOLS,
} from '../../src/portfolio/source-constant-direction';
import type { DailyPriceRow } from '../../src/portfolio/types';

const fixtureRoot = resolve(__dirname, '../fixtures/cct-source-projection');
// Reuse the immutable registered source artifact; do not copy or regenerate it.
const archive = resolve(__dirname, '../../../docs/audits/futures-quick-win/constant-direction-20261016T121748Z/source');
const targetBytes = readFileSync(resolve(archive, 'targets-128d.ndjson'));
const receipt = JSON.parse(readFileSync(resolve(archive, 'source-generation-receipt.json'), 'utf8'));
const fixture = targetBytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const csv = readFileSync(resolve(fixtureRoot, 'daily-source.csv'), 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
const symbols = csv[0].slice(1);
const rows: DailyPriceRow[] = csv.slice(1).map(values => ({ openTimeMs: Date.parse(`${values[0]}T00:00:00Z`),
  closes: Object.fromEntries(symbols.map((symbol, i) => [symbol, values[i + 1] === '' ? null : Number(values[i + 1])])) }));
const DAY = 86_400_000;
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
let series: ReturnType<typeof buildConstantDirectionSourceTargetSeries> | undefined;
const targets = () => series ??= buildConstantDirectionSourceTargetSeries(rows, {
  startTimeMs: fixture[0].executeAtMs - 7 * 3_600_000,
  endTimeMs: fixture[fixture.length - 1].executeAtMs + 17 * 3_600_000,
});

describe('constant-direction registered source128 parity', () => {
  it('matches the archived 5120 raw4/execution weights and all640 independent volatility/direction rows', () => {
    expect(createHash('sha256').update(targetBytes).digest('hex')).toBe(receipt.targetSha256);
    expect(receipt.targetSha256).toBe('6f5a7b1132d0b6a3aaf79014610a9c414ea28f12a09683739fd6bcc52b1db982');
    const actual = targets();
    expect(actual).toHaveLength(128);
    let weightChecks = 0, metadataChecks = 0;
    for (let i = 0; i < actual.length; i++) {
      const a = actual[i], b = fixture[i];
      expect(a.sourceId).toBe(b.sourceId);
      expect(a.labelTimeMs).toBe(b.labelTimeMs);
      expect(a.knownAtMs).toBe(b.knownAtMs);
      expect(a.executeAtMs).toBe(b.executeAtMs);
      for (const symbol of symbols) {
        expect(a.raw4Weights[symbol], `raw4 ${i}/${symbol}`).toBe(b.weights[symbol]);
        expect(new Money(a.decimalWeights[symbol]).eq(b.executionWeightsScalar6[symbol]), `execution ${i}/${symbol}`).toBe(true);
        expect(a.weights[symbol]).toBe(new Money(b.executionWeightsScalar6[symbol]).toNumber());
        expect(a.executionWeightsScalar6[symbol]).toBe(a.decimalWeights[symbol]);
        expect(a.baseDesiredWeights[symbol]).toBe(b.baseDesiredWeights[symbol]);
        weightChecks++;
      }
      for (const symbol of CONSTANT_DIRECTION_SOURCE_SYMBOLS) {
        expect(a.metadata[symbol], `metadata ${i}/${symbol}`).toEqual(b.metadata[symbol]);
        metadataChecks++;
      }
    }
    expect(weightChecks).toBe(5120);
    expect(metadataChecks).toBe(640);
  }, 180_000);

  it('keeps source identities and direction constant across calls without a first-row count-change bypass', () => {
    const actual = targets();
    expect(new Set(actual.map(row => row.sourceId)).size).toBe(128);
    expect(new Set(actual.map(row => row.originalSourceId))).toEqual(new Set([CONSTANT_DIRECTION_SOURCE_REVISION]));
    for (const row of actual) {
      expect(row.policyId).toBe(CONSTANT_DIRECTION_POLICY_ID);
      expect(row.strategy).toBe('constant-direction-b5-v1');
      for (const symbol of CONSTANT_DIRECTION_SOURCE_SYMBOLS) {
        expect(row.metadata[symbol].signedSignalCount).toBe(9);
        expect(row.metadata[symbol].signalCountChanged).toBe(false);
        expect(Object.values(row.metadata[symbol].signalStates)).toEqual(Array(9).fill(1));
        expect(Object.values(row.metadata[symbol].nextStops)).toEqual(Array(9).fill(null));
      }
    }
    expect(buildConstantDirectionSourceTargets(rows, actual[64].executeAtMs)).toEqual(actual[64]);
  }, 180_000);

  it('ignores all future closes, but uses the just-closed daily bar without an extra lag', () => {
    const before = targets()[48], at = before.executeAtMs;
    const futureCorrupt = rows.map(row => row.openTimeMs >= at
      ? { ...row, closes: Object.fromEntries(symbols.map(symbol => [symbol, NaN])) } : row);
    expect(buildConstantDirectionSourceTargets(futureCorrupt, at)).toEqual(before);
    const changedKnown = rows.map(row => row.openTimeMs === at - DAY
      ? { ...row, closes: { ...row.closes, BTCUSDT: row.closes.BTCUSDT! * 1.1 } } : row);
    const after = buildConstantDirectionSourceTargets(changedKnown, at);
    expect(after.metadata.BTCUSDT.annVol90).not.toBe(before.metadata.BTCUSDT.annVol90);
    expect(after.decimalWeights.BTCUSDT).not.toBe(before.decimalWeights.BTCUSDT);
    expect(after.metadata.ETHUSDT).toEqual(before.metadata.ETHUSDT);
  }, 180_000);

  it('requires360 observed bars, complete chronological UTC history, and finite positive B5 closes', () => {
    const at = fixture[0].executeAtMs;
    const before = rows.filter(row => row.openTimeMs < at);
    expect(() => buildConstantDirectionSourceTargets(before.slice(-359), at)).toThrow(/360/);
    expect(() => buildConstantDirectionSourceTargets(before.slice(-360), at)).not.toThrow();
    expect(() => buildConstantDirectionSourceTargets(rows.filter((_, i) => i !== 80), at)).toThrow(/consecutive/);
    expect(() => buildConstantDirectionSourceTargets(rows, at + 1)).toThrow(/midnight/);
    const bad = before.map((row, i) => i === 50 ? { ...row, closes: { ...row.closes, SOLUSDT: null } } : row);
    expect(() => buildConstantDirectionSourceTargets(bad, at)).toThrow(/finite and positive/);
    const flat = before.map(row => ({ ...row, closes: { ...row.closes, BTCUSDT: 100 } }));
    expect(() => buildConstantDirectionSourceTargets(flat, at)).toThrow(/positive 90-return/);
  }, 180_000);
});
