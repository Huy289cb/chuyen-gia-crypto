import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';
import { PortfolioPaperEngine } from '../../src/portfolio/paper-engine';
import {
  buildCctPaperConfig, buildConstantDirectionConfig, CONSTANT_DIRECTION_POLICY, normalizePortfolioPaperPolicy,
} from '../../src/portfolio/policy-registry';
import {
  buildConstantDirectionSourceTargets, CONSTANT_DIRECTION_SOURCE_REVISION, CONSTANT_DIRECTION_SOURCE_SYMBOLS,
} from '../../src/portfolio/source-constant-direction';
import type { DailyPriceRow, PortfolioPaperConfig, SourcePortfolioTargets } from '../../src/portfolio/types';

const DAY = 86_400_000, START = Date.UTC(2026, 5, 8);
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const marks = Object.fromEntries(CONSTANT_DIRECTION_SOURCE_SYMBOLS.map(symbol => [symbol, '100']));
const filters = Object.fromEntries(CONSTANT_DIRECTION_SOURCE_SYMBOLS.map(symbol => [symbol,
  { stepSize: '.01', minQty: '.01', minNotional: '1', maxQty: '10000' }]));
const config = () => buildConstantDirectionConfig(filters, { feeRate: '0', slippageBps: '0' });
const target = (time: number, weights: Record<string, number>): SourcePortfolioTargets => ({
  weights: { ...Object.fromEntries(CONSTANT_DIRECTION_SOURCE_SYMBOLS.map(symbol => [symbol, 0])), ...weights },
  sourceId: `${CONSTANT_DIRECTION_SOURCE_REVISION}:${time}`, strategy: 'constant-direction-b5-v1',
  policyId: CONSTANT_DIRECTION_POLICY.id, sourceRevision: CONSTANT_DIRECTION_SOURCE_REVISION,
  knownAtMs: time, executeAtMs: time, labelTimeMs: time - DAY,
  metadata: Object.fromEntries(CONSTANT_DIRECTION_SOURCE_SYMBOLS.map(symbol => [symbol,
    { signalCountChanged: false, signedSignalCount: 9 }])),
});

describe('constant-direction independent strategy and shared money engine', () => {
  it('registers the explicit15u policy with the original soft threshold, costs, sizing and unchanged legacy hashes', () => {
    expect(buildConstantDirectionConfig(filters)).toMatchObject({
      strategy: 'constant-direction-b5-v1', policyId: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1',
      initialCash: '100', dailyLossLimitUsd: '15', closeBufferUsd: '6.1', grossCap: '8', leverage: '10',
      bandThreshold: '0.2', feeRate: '0.0005', slippageBps: '2',
    });
    expect(normalizePortfolioPaperPolicy()).toBe('momentum-v1');
    expect(normalizePortfolioPaperPolicy(CONSTANT_DIRECTION_POLICY.strategy)).toBe(CONSTANT_DIRECTION_POLICY.id);
    const oneFilter = { BTCUSDT: filters.BTCUSDT };
    // Recorded from the existing implementation before generalizing its branch.
    expect(new PortfolioPaperEngine({ filters: oneFilter, feeRate: '0', slippageBps: '0' }).snapshot().configHash)
      .toBe('d8a0ab581bcb6930d7f0be10aa050e16c3573939fd2f5ba5f7e2eb57b9bfcd12');
    expect(new PortfolioPaperEngine(buildCctPaperConfig(oneFilter, { feeRate: '0', slippageBps: '0' })).snapshot().configHash)
      .toBe('95274057da1d7c09f9bd6b2ca57e63dd7e45161638fc57371310e34d0e5815ad');
  });

  it('executes an actual independently generated target, reconciles entry costs, and deduplicates it after restart', () => {
    const csv = readFileSync(resolve(__dirname, '../fixtures/cct-source-projection/daily-source.csv'), 'utf8')
      .trim().split(/\r?\n/).map(line => line.split(','));
    const symbols = csv[0].slice(1);
    const rows: DailyPriceRow[] = csv.slice(1).map(values => ({ openTimeMs: Date.parse(`${values[0]}T00:00:00Z`),
      closes: Object.fromEntries(symbols.map((symbol, i) => [symbol, values[i + 1] === '' ? null : Number(values[i + 1])])) }));
    const actual = buildConstantDirectionSourceTargets(rows, START);
    const cfg = buildConstantDirectionConfig(filters), engine = new PortfolioPaperEngine(cfg);
    const result = engine.step({ id: 'actual-source-entry', time: START, marks, targets: actual });
    expect(result.snapshot.lastTargets?.sourceId).toBe(actual.sourceId);
    expect(result.snapshot.rebalanceCount).toBe(1);
    expect(result.events.some(event => event.kind === 'projection')).toBe(true);
    expect(Object.keys(result.snapshot.positions)).toHaveLength(5);
    expect(Object.values(result.snapshot.positions).every(position => new Money(position.quantity).gt(0))).toBe(true);
    expect(new Money(result.snapshot.equity).sub(100).eq(new Money(result.snapshot.totalFees).add(result.snapshot.totalSlippage).neg())).toBe(true);
    expect(new Money(result.snapshot.grossNotional).lte(new Money(result.snapshot.equity).mul(8))).toBe(true);
    const reserve = result.events.filter(event => event.kind === 'buffer_admission_reserve');
    expect(reserve.length).toBe(5);
    expect(reserve.every(event => event.softBudgetThreshold === '-8.9' && event.closeBuffer === '6.1')).toBe(true);
    const restored = new PortfolioPaperEngine(cfg, result.snapshot);
    expect(restored.step({ id: 'repeat-source-after-restart', time: START, marks, targets: actual }).events).toEqual([]);
    expect(restored.snapshot().fillCount).toBe(result.snapshot.fillCount);
  }, 180_000);

  it('isolates strategy, policy and risk configuration on restart', () => {
    const engine = new PortfolioPaperEngine(config()), saved = engine.snapshot();
    expect(() => new PortfolioPaperEngine(config(), saved)).not.toThrow();
    for (const override of [
      { dailyLossLimitUsd: '10' }, { closeBufferUsd: '1.1' }, { grossCap: '7' },
      { sourceRevision: 'other' }, { solverRevision: 'other' }, { policyId: 'other' },
    ] satisfies Partial<PortfolioPaperConfig>[]) {
      expect(() => new PortfolioPaperEngine({ ...config(), ...override }, saved)).toThrow('config mismatch');
    }
    expect(() => new PortfolioPaperEngine(buildCctPaperConfig(filters, { feeRate: '0', slippageBps: '0' }), saved)).toThrow('config mismatch');
    expect(() => new PortfolioPaperEngine({ filters, feeRate: '0', slippageBps: '0' }, saved)).toThrow('config mismatch');
  });

  it('rejects cross-policy, cross-strategy and contaminated constant-direction targets atomically', () => {
    const engine = new PortfolioPaperEngine(config()), before = engine.snapshot(), good = target(START, { BTCUSDT: 1 });
    const badTargets: SourcePortfolioTargets[] = [
      { ...good, policyId: undefined }, { ...good, policyId: 'CCT_LC_B5_S6_BUFFER11_V1' },
      { ...good, strategy: 'cct-lc-b5-v1' }, { ...good, sourceRevision: 'other' },
      { ...good, weights: { ...good.weights, BTCUSDT: -1 } },
      { ...good, metadata: { ...good.metadata, BTCUSDT: { signalCountChanged: true, signedSignalCount: 9 } } },
      { ...good, metadata: { ...good.metadata, BTCUSDT: { signalCountChanged: false, signedSignalCount: 0 } } },
    ];
    for (const [i, bad] of badTargets.entries()) {
      expect(() => engine.step({ id: `bad-${i}`, time: START, marks, targets: bad })).toThrow();
      expect(engine.snapshot()).toEqual(before);
    }
  });

  it('retains the exact-8.9u soft close and reports an observed gap beyond15u truthfully', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'entry', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    const stop = engine.step({ id: 'soft', time: START + 1, marks: { ...marks, BTCUSDT: '91.1' } });
    expect(stop.snapshot.currentDay).toMatchObject({ netPnl: '-8.9', riskLatched: true, breachUsd: '0' });
    expect(stop.events.find(event => event.kind === 'buffer_latch_context')).toMatchObject({
      closeBuffer: '6.1', softBudgetThreshold: '-8.9', latchReason: 'fixed_daily_loss_close_reserve',
    });
    const gap = new PortfolioPaperEngine(config());
    gap.step({ id: 'entry', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    gap.step({ id: 'gap', time: START + 1, marks: { ...marks, BTCUSDT: '84' } });
    expect(gap.summary()).toMatchObject({ netPnl: '-16', maxDailyBreachUsd: '1', riskLatched: true });
    expect(gap.snapshot().positions).toEqual({});
  });

  it('enforces hard15u on a recovered flat deficit without treating it as15percent of NAV', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'initial', time: START, marks, cashflows: [{ id: 'deposit', amount: '100' }] });
    const boundary = START + 17 * 3_600_000;
    engine.step({ id: 'new-day-200u-anchor', time: boundary, marks });
    // Recovered flat balances can arrive after costs have already been booked.
    // With no gross exposure, the soft-close branch cannot supply this latch.
    const recovered = engine.snapshot();
    expect(recovered.currentDay!.anchorEquity).toBe('200');
    recovered.cash = recovered.equity = '185';
    recovered.currentDay!.netPnl = recovered.currentDay!.worstNetPnl = '-15';
    recovered.currentDay!.endEquity = '185';
    const restored = new PortfolioPaperEngine(config(), recovered);
    const result = restored.step({ id: 'reconcile-flat-deficit', time: boundary + 1, marks });
    expect(result.snapshot.currentDay).toMatchObject({ riskLatched: true, latchReason: 'fixed_daily_loss_observed', breachUsd: '0' });
    expect(result.events.filter(event => event.kind === 'risk_latch')).toEqual([
      expect.objectContaining({ reason: 'fixed_daily_loss_observed' }),
    ]);
  });

  it('keeps10/buffer1.1 and15/buffer6.1 execution equivalent when the soft close wins, with distinct breach annotations', () => {
    const old = new PortfolioPaperEngine(buildCctPaperConfig(filters)), next = new PortfolioPaperEngine(buildConstantDirectionConfig(filters));
    const asOld = (row: SourcePortfolioTargets): SourcePortfolioTargets => ({ ...row, strategy: 'cct-lc-b5-v1', policyId: 'CCT_LC_B5_S6_BUFFER11_V1', sourceRevision: undefined });
    const frames = [
      { id: 'entry', time: START, marks, targets: target(START, { BTCUSDT: .8, ETHUSDT: .8 }) },
      { id: 'same-count-band', time: START + 1, marks, targets: target(START + 1, { BTCUSDT: .9, ETHUSDT: .9 }) },
      { id: 'funding', time: START + 2, marks, funding: [{ id: 'fund', symbol: 'BTCUSDT', rate: '.001', markPrice: '100' }] },
      { id: 'gap-soft-priority', time: START + 3, marks: { ...marks, BTCUSDT: '92', ETHUSDT: '92' } },
      { id: 'blocked-reentry', time: START + 4, marks, targets: target(START + 4, { BTCUSDT: 1 }) },
      { id: 'exact-ICT-reset', time: START + 17 * 3_600_000, marks },
    ];
    for (const frame of frames) {
      const a = old.step({ ...frame, ...('targets' in frame && frame.targets ? { targets: asOld(frame.targets) } : {}) });
      const b = next.step(frame);
      for (const field of ['cash', 'equity', 'positions', 'grossNotional', 'marginUsed', 'totalFees', 'totalSlippage', 'fundingPnl', 'realizedPnl', 'fillCount', 'rebalanceCount', 'rejectedCount'] as const) {
        expect(b.snapshot[field], `${frame.id}/${field}`).toEqual(a.snapshot[field]);
      }
      expect(b.events.filter(event => event.kind === 'fill')).toEqual(a.events.filter(event => event.kind === 'fill'));
      expect(b.snapshot.currentDay?.riskLatched).toBe(a.snapshot.currentDay?.riskLatched);
    }
    expect(new Money(old.summary().maxDailyBreachUsd).gt(0)).toBe(true);
    expect(next.summary().maxDailyBreachUsd).toBe('0');
    expect(next.snapshot().positions).toEqual({});
    expect(next.snapshot().rebalanceCount).toBe(2);
  });
});
