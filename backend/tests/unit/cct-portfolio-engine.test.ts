import { describe, expect, it } from 'vitest';
import { PortfolioPaperEngine } from '../../src/portfolio/paper-engine';
import { buildCctPaperConfig, CCT_PAPER_POLICY } from '../../src/portfolio/policy-registry';
import { CCT_SOURCE_SYMBOLS } from '../../src/portfolio/source-cct';
import type { SourcePortfolioTargets } from '../../src/portfolio/types';

const DAY = 86_400_000, START = Date.UTC(2026, 5, 7, 17);
const marks = Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, '100']));
const filters = Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, { stepSize: '.01', minQty: '.01', minNotional: '1', maxQty: '10000' }]));
const config = () => buildCctPaperConfig(filters, { feeRate: '0', slippageBps: '0' });
const target = (time: number, weights: Record<string, number>, changed = true): SourcePortfolioTargets => ({
  weights: { ...Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, 0])), ...weights },
  sourceId: `cct-test-v1:${time}`, originalSourceId: 'same-original-every-day', strategy: 'cct-lc-b5-v1',
  knownAtMs: time, executeAtMs: time, labelTimeMs: time - DAY,
  metadata: Object.fromEntries(CCT_SOURCE_SYMBOLS.map(s => [s, { signalCountChanged: changed }])),
});
describe('versioned CCT shared money engine', () => {
  it('admits raw gross12 for legal projection to wallet8, without restoring momentum gross2', () => {
    const engine = new PortfolioPaperEngine(config());
    const result = engine.step({ id: 'source', time: START, marks, targets: target(START, { BTCUSDT: 4, ETHUSDT: 4, BNBUSDT: 4 }) });
    expect(result.events.some(e => e.kind === 'projection')).toBe(true);
    expect(Number(result.snapshot.grossNotional)).toBeGreaterThan(200);
    expect(Number(result.snapshot.grossNotional)).toBeLessThanOrEqual(Number(result.snapshot.equity) * 8);
    expect(result.snapshot.rebalanceCount).toBe(1);
  });
  it('uses actual inventory band only when count unchanged, and date identities execute again after restart', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'first', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    const second = target(START + 1, { BTCUSDT: 1.1 }, false);
    engine.step({ id: 'unchanged-count', time: START + 1, marks, targets: second });
    expect(engine.snapshot().positions.BTCUSDT.quantity).toBe('1');
    const restored = new PortfolioPaperEngine(config(), engine.snapshot());
    expect(restored.step({ id: 'repeat-same-row', time: START + 1, marks, targets: second }).events).toEqual([]);
    restored.step({ id: 'changed-count', time: START + 2, marks, targets: target(START + 2, { BTCUSDT: 1.1 }, true) });
    expect(restored.snapshot().positions.BTCUSDT.quantity).toBe('1.1');
    expect(restored.snapshot().rebalanceCount).toBe(3);
  });
  it('keeps exact soft boundary, truthful hard overshoot, and does not reenter at ICT reset', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'first', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    const stop = engine.step({ id: 'soft-boundary', time: START + 1, marks: { ...marks, BTCUSDT: '91.1' } });
    expect(stop.snapshot.currentDay?.netPnl).toBe('-8.9');
    expect(stop.snapshot.currentDay?.riskLatched).toBe(true);
    expect(stop.events.find(e => e.kind === 'buffer_latch_context')?.softBudgetThreshold).toBe('-8.9');
    engine.step({ id: 'reset', time: START + DAY, marks });
    expect(engine.snapshot().positions).toEqual({});
    expect(engine.snapshot().rebalanceCount).toBe(1);
    const gap = new PortfolioPaperEngine(config());
    gap.step({ id: 'first', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    gap.step({ id: 'gap', time: START + 1, marks: { ...marks, BTCUSDT: '80' } });
    expect(gap.summary().netPnl).toBe('-20');
    expect(gap.summary().maxDailyBreachUsd).toBe('10');
  });
  it('hashes strategy/source/solver/band/gross/buffer and refuses incompatible checkpoints', () => {
    const engine = new PortfolioPaperEngine(config());
    for (const change of [{ sourceRevision: 'changed' }, { solverRevision: 'changed' }, { bandThreshold: '.21' }, { grossCap: '7' }, { closeBufferUsd: '1.2' }]) {
      expect(() => new PortfolioPaperEngine({ ...config(), ...change }, engine.snapshot())).toThrow('config mismatch');
    }
    expect(() => new PortfolioPaperEngine({ filters, feeRate: '0', slippageBps: '0' }, engine.snapshot())).toThrow('config mismatch');
    expect(config().policyId).toBe(CCT_PAPER_POLICY.id);
  });
  it('keeps forty-digit realized PnL when partially closing a repeating average entry', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'first-lot', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    engine.step({ id: 'second-lot', time: START + 1, marks: { ...marks, BTCUSDT: '101' },
      targets: target(START + 1, { BTCUSDT: 1.7 }) });
    expect(engine.snapshot().positions.BTCUSDT).toEqual({ quantity: '1.7',
      averageEntry: '100.4117647058823529411764705882352941176' });
    const result = engine.step({ id: 'partial-close', time: START + 2, marks: { ...marks, BTCUSDT: '110' },
      targets: target(START + 2, { BTCUSDT: 77 / 116.3 }) });
    const fill = result.events.find(event => event.kind === 'fill');
    expect(fill?.quantity).toBe('-1');
    expect(fill?.realizedPnl).toBe('9.5882352941176470588235294117647058824');
    expect(fill?.cashDelta).toBe(fill?.realizedPnl);
    expect(result.snapshot.positions.BTCUSDT.quantity).toBe('0.7');
  });
  it('replay transition mode preserves checkpoints/idempotency and rolls back a failure after day rollover', () => {
    const engine = new PortfolioPaperEngine(config());
    const first = engine.step({ id: 'first', time: START, marks, targets: target(START, { BTCUSDT: 1 }) }, { snapshot: false });
    expect('snapshot' in first).toBe(false);
    const before = engine.snapshot();
    // Missing market reference only fails inside projection, after the roll.
    expect(() => engine.step({ id: 'failed-next-day', time: START + DAY, marks, tradePrices: {}, targets: target(START + DAY, { BTCUSDT: 2 }) }, { snapshot: false })).toThrow();
    expect(engine.snapshot()).toEqual(before);
    const restored = new PortfolioPaperEngine(config(), before);
    expect(restored.step({ id: 'first', time: START, marks }, { snapshot: false }).duplicate).toBe(true);
  });
  it('revalues marks, cashflow, funding and partial fills within a single transition', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'entry', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    const result = engine.step({ id: 'fund-and-reduce', time: START + 1, marks: { ...marks, BTCUSDT: '110' },
      cashflows: [{ id: 'deposit', amount: '5' }],
      funding: [{ id: 'payment', symbol: 'BTCUSDT', time: START + 1, rate: '.01', markPrice: '110' }],
      targets: target(START + 1, { BTCUSDT: 55 / 113.9 }) });
    expect(result.snapshot).toMatchObject({ cash: '108.9', equity: '113.9', grossNotional: '55', marginUsed: '5.5',
      netCashflow: '5', fundingPnl: '-1.1', realizedPnl: '5' });
    expect(result.snapshot.positions.BTCUSDT.quantity).toBe('0.5');
    expect(result.snapshot.currentDay?.netPnl).toBe('8.9');
    engine.step({ id: 'close', time: START + 2, marks: { ...marks, BTCUSDT: '108' }, forceClose: 'test' });
    expect(engine.snapshot()).toMatchObject({ cash: '112.9', equity: '112.9', grossNotional: '0', marginUsed: '0', positions: {} });
    expect(engine.summary().netPnl).toBe('7.9');
  });
  it('checks risk on the new valuation immediately after funding changes cash', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'entry', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    const result = engine.step({ id: 'funding-stop', time: START + 1, marks,
      funding: [{ id: 'large-payment', symbol: 'BTCUSDT', time: START + 1, rate: '.089', markPrice: '100' }] });
    expect(result.snapshot.positions).toEqual({});
    expect(result.snapshot.currentDay?.riskLatched).toBe(true);
    expect(result.snapshot.equity).toBe('91.1');
    expect(result.events.some(event => event.kind === 'fill' && event.reason === 'fixed_daily_loss_close_reserve')).toBe(true);
  });
  it('detaches wallet observations while omitting source metadata and target maps', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'first', time: START, marks, targets: target(START, { BTCUSDT: 1 }) });
    const before = engine.snapshot(), observed = engine.walletObservation();
    expect(observed.cash).toBe(before.cash);
    expect(observed.positions).toEqual(before.positions);
    expect(observed.currentDay).toEqual(before.currentDay);
    for (const key of ['days','processedStepIds','processedFundingIds','processedCashflowIds','lastTargets','targetWeights','targetQuantities']) expect(key in observed).toBe(false);
    observed.positions.BTCUSDT.quantity = '999';
    delete observed.positions.BTCUSDT;
    observed.marks.BTCUSDT = '1';
    observed.currentDay!.anchorEquity = '1';
    expect(engine.snapshot()).toEqual(before);
  });
  it('preserves first-latch priority and captures inventory and money before flattening', () => {
    const engine = new PortfolioPaperEngine({ ...config(), maintenanceRate: '.2' });
    engine.step({ id: 'first', time: START, marks, targets: target(START, { BTCUSDT: 4 }) });
    const result = engine.step({ id: 'all-three-risk-conditions', time: START + 1, marks: { ...marks, BTCUSDT: '80' } });
    expect(result.events.filter(e => e.kind === 'risk_latch')).toHaveLength(1);
    expect(result.events.filter(e => e.kind === 'buffer_latch_context')).toHaveLength(1);
    const context = result.events.find(e => e.kind === 'buffer_latch_context')!;
    expect(context).toMatchObject({ latchReason: 'fixed_daily_loss_close_reserve', observedNet: '-80', equity: '20',
      anchorEquity: '100', gross: '320', closeReserve: '0', closeBuffer: '1.1', softBudgetThreshold: '-8.9',
      quantities: { BTCUSDT: '4' }, marks: { BTCUSDT: '80' }, references: { BTCUSDT: '80' } });
    expect(result.snapshot.positions).toEqual({});
    expect(result.snapshot.currentDay?.breachUsd).toBe('70');
  });
});
