import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';
import { applyCctActualInventoryBand, projectCctTargets } from '../../src/portfolio/target-projection';
import type { CctProjectionInput } from '../../src/portfolio/target-projection';

const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/cct-source-projection/projection.json'), 'utf8'));
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const d = (x: string | number): Decimal => new Money(x);
const keyMap: Record<string, string> = { pre_equity: 'preEquity', estimated_post_equity: 'estimatedPostEquity',
  tracking_error_usd: 'trackingErrorUsd', net_deviation_usd: 'netDeviationUsd', target_net_usd: 'targetNetUsd',
  actual_net_usd: 'actualNetUsd', immediate_cost_usd: 'immediateCostUsd', close_reserve_usd: 'closeReserveUsd', objective_usd: 'objectiveUsd' };

describe('CCT finite actual-inventory projector frozen pure-function parity', () => {
  for (const fixture of fixtures) it(fixture.name, () => {
    const actual = projectCctTargets(fixture.input as CctProjectionInput);
    expect(actual.feasible).toBe(fixture.expected.feasible);
    expect(actual.reason).toBe(fixture.expected.reason);
    expect(actual.iterations).toBe(fixture.expected.iterations);
    expect(Object.keys(actual.quantities)).toEqual(Object.keys(fixture.expected.quantities));
    for (const [s, quantity] of Object.entries(fixture.expected.quantities)) expect(d(actual.quantities[s]).eq(d(quantity as string))).toBe(true);
    expect(actual.orders).toHaveLength(fixture.expected.orders.length);
    for (let i = 0; i < actual.orders.length; i++) {
      const a = actual.orders[i], b = fixture.expected.orders[i];
      expect(a.symbol).toBe(b.symbol); expect(a.reduceOnly).toBe(b.reduceOnly);
      for (const k of ['quantity', 'referencePrice', 'fillPrice', 'fee'] as const) expect(d(a[k]).eq(d(b[k]))).toBe(true);
    }
    for (const [k, v] of Object.entries(fixture.expected)) {
      const mapped = keyMap[k] ?? k;
      if (['gross', ...Object.values(keyMap)].includes(mapped)) {
        const exact = (actual as unknown as Record<string, string>)[mapped];
        expect(d(exact).sub(d(v as string)).abs().lte('1e-30'), `${fixture.name}/${mapped}`).toBe(true);
      }
    }
  });

  it('all feasible outputs satisfy exact post-cost gross, margin and strict daily reservation', () => {
    for (const fixture of fixtures) {
      const a = projectCctTargets(fixture.input);
      if (!a.feasible) { expect(a.orders).toEqual([]); continue; }
      const after = d(a.estimatedPostEquity), reserve = d(a.closeReserveUsd), gross = d(a.gross);
      expect(after.gt(0)).toBe(true);
      expect(gross.lte(after.mul(fixture.input.grossCap))).toBe(true);
      expect(gross.div(fixture.input.leverage).add(reserve).lte(after)).toBe(true);
      expect(after.sub(fixture.input.dayAnchor).sub(fixture.input.dayNetCashflow ?? 0).sub(reserve).gt('-8.9')).toBe(true);
      let increasing = false;
      for (const order of a.orders) {
        if (!order.reduceOnly) increasing = true;
        if (order.reduceOnly) expect(increasing).toBe(false);
        const f = fixture.input.filters[order.symbol], qty = d(order.quantity).abs();
        expect(qty.mod(f.marketStepSize ?? f.stepSize).isZero()).toBe(true);
        expect(qty.gte(f.marketMinQty ?? f.minQty)).toBe(true);
        expect(qty.lte(f.marketMaxQty ?? f.maxQty)).toBe(true);
        if (!order.reduceOnly) expect(qty.mul(fixture.input.marks[order.symbol]).gte(f.minNotional)).toBe(true);
      }
    }
  });

  it('source12 remains a request and is projected under post-cost cap8 without an artificial cap2', () => {
    const fixture = fixtures.find((f: { name: string }) => f.name === 'source_gross12_is_projected_not_clipped');
    const a = projectCctTargets(fixture.input);
    expect(d(a.targetNetUsd).eq(1200)).toBe(true);
    expect(d(a.gross).gt(200)).toBe(true);
    expect(d(a.gross).lte(d(a.estimatedPostEquity).mul(8))).toBe(true);
  });
});

describe('CCT actual-inventory band exact boundaries', () => {
  const base = { positions: { A: { quantity: '1' } }, equity: '100', marks: { A: '10' }, metadata: { A: { signalCountChanged: false } } };
  it('retains actual inventory at exactly20%, admits just outside, and ignores unfunded sleeve diagnostics', () => {
    expect(applyCctActualInventoryBand({ ...base, weights: { A: '.12' } })).toEqual({ A: '0.1' });
    expect(applyCctActualInventoryBand({ ...base, weights: { A: '.120000000000000000000000000000000001' } })).toEqual({ A: '0.120000000000000000000000000000000001' });
    expect(applyCctActualInventoryBand({ ...base, weights: { A: '.08' } })).toEqual({ A: '0.1' });
  });
  it('uses desired when count changes, inventory is flat, sign flips or source goes cash', () => {
    expect(applyCctActualInventoryBand({ ...base, weights: { A: '.12' }, metadata: { A: { signalCountChanged: true } } })).toEqual({ A: '0.12' });
    expect(applyCctActualInventoryBand({ ...base, weights: { A: '.1' }, positions: {} })).toEqual({ A: '0.1' });
    expect(applyCctActualInventoryBand({ ...base, weights: { A: '-.1' } })).toEqual({ A: '-0.1' });
    expect(applyCctActualInventoryBand({ ...base, weights: { A: '0' } })).toEqual({ A: '0' });
  });
  it('keeps Decimal40 actual weights without a number roundtrip', () => {
    const result = applyCctActualInventoryBand({ ...base, positions: { A: '1' }, equity: '3', marks: { A: '1' }, weights: { A: '.333' } });
    expect(result.A).toBe('0.3333333333333333333333333333333333333333');
  });
});
