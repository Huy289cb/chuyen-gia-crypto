import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';
import { buildCctSourceTargets, buildCctSourceTargetSeries, CCT_SOURCE_SYMBOLS } from '../../src/portfolio/source-cct';
import type { DailyPriceRow } from '../../src/portfolio/types';

const root = resolve(__dirname, '../fixtures/cct-source-projection');
const fixture = JSON.parse(readFileSync(resolve(root, 'source128.json'), 'utf8'));
const csv = readFileSync(resolve(root, 'daily-source.csv'), 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
const symbols = csv[0].slice(1);
const rows: DailyPriceRow[] = csv.slice(1).map(values => ({ openTimeMs: Date.parse(`${values[0]}T00:00:00Z`),
  closes: Object.fromEntries(symbols.map((s, i) => [s, values[i + 1] === '' ? null : Number(values[i + 1])])) }));
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
// One full seed pass supplies the common parity/identity expectations.
let series: ReturnType<typeof buildCctSourceTargetSeries> | undefined;
const targets = (): ReturnType<typeof buildCctSourceTargetSeries> => series ??= buildCctSourceTargetSeries(rows, fixture);

describe('CCT source registered128 engineering parity', () => {
  it('matches all5120 source weights and640 state/count/prior-stop/next-stop rows', () => {
    const actual = targets();
    expect(actual).toHaveLength(128);
    let weights = 0, metadataRows = 0;
    for (let i = 0; i < actual.length; i++) {
      const a = actual[i], b = fixture.rows[i];
      expect(a.labelTimeMs).toBe(b.labelTimeMs);
      expect(a.knownAtMs).toBe(b.knownAtMs);
      expect(a.executeAtMs).toBe(b.executeAtMs);
      expect(a.knownAtMs).toBe(a.executeAtMs);
      expect(a.knownAtMs - a.labelTimeMs).toBe(86_400_000);
      expect(a.originalSourceId).toBe(b.sourceId);
      for (const s of symbols) {
        const expected = new Money(String(b.weights[s])).mul('.75').mul(2);
        expect(a.decimalWeights[s], `source decimal ${i}/${s}`).toBe(expected.isZero() ? '0' : expected.toString());
        expect(a.weights[s]).toBe(expected.toNumber());
        weights++;
      }
      for (const s of CCT_SOURCE_SYMBOLS) {
        // Exact equality intentionally includes sample vol and every diagnostic,
        // not merely directions or a loose aggregate tolerance.
        expect(a.metadata[s], `source metadata ${i}/${s}`).toEqual(b.metadata[s]);
        metadataRows++;
      }
    }
    expect(weights).toBe(5120);
    expect(metadataRows).toBe(640);
  }, 180_000);

  it('uses stable daily execution identities while preserving the original constant source identity', () => {
    const actual = targets();
    expect(new Set(actual.map(r => r.sourceId)).size).toBe(128);
    expect(new Set(actual.map(r => r.originalSourceId)).size).toBe(1);
    const index = 64;
    expect(buildCctSourceTargets(rows, actual[index].executeAtMs)).toEqual(actual[index]);
  }, 180_000);

  it('ignores perturbed future closes and never carries the old extra UTC lag', () => {
    const at = fixture.rows[48].executeAtMs;
    const before = targets()[48];
    const perturbed = rows.map(row => row.openTimeMs >= at
      ? { ...row, closes: Object.fromEntries(symbols.map(s => [s, s === 'BTCUSDT' ? NaN : -123])) } : row);
    expect(buildCctSourceTargets(perturbed, at)).toEqual(before);
    const labelIndex = rows.findIndex(row => row.openTimeMs === at - 86_400_000);
    const currentCloseChanged = rows.map((row, i) => i === labelIndex
      ? { ...row, closes: { ...row.closes, BTCUSDT: row.closes.BTCUSDT! * 1.1 } } : row);
    expect(buildCctSourceTargets(currentCloseChanged, at).metadata.BTCUSDT).not.toEqual(before.metadata.BTCUSDT);
  }, 180_000);

  it('rejects missing seed history, daily gaps and partial UTC execution times', () => {
    const at = fixture.rows[0].executeAtMs;
    expect(() => buildCctSourceTargets(rows.slice(-100), at)).toThrow();
    expect(() => buildCctSourceTargets(rows.filter((_, i) => i !== 80), at)).toThrow(/consecutive/);
    expect(() => buildCctSourceTargets(rows, at + 1)).toThrow(/midnight/);
  });
});
