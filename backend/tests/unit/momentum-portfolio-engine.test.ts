import { describe, expect, it } from 'vitest';
import { PortfolioPaperEngine } from '../../src/portfolio/paper-engine';
import { buildSourceTargets, sourceRankWeights, SOURCE_UNIVERSE } from '../../src/portfolio/source-momentum';
import type { DailyPriceRow, PortfolioPaperConfig, SourcePortfolioTargets } from '../../src/portfolio/types';

const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 29, 17); // 30/09 00:00 ICT
const filters = {
  BTCUSDT: { stepSize: '0.01', minQty: '0.01', minNotional: '1' },
  ETHUSDT: { stepSize: '0.01', minQty: '0.01', minNotional: '1' },
};
const config = (extra: Partial<PortfolioPaperConfig> = {}): PortfolioPaperConfig => ({ filters, feeRate: '0', slippageBps: '0', ...extra });
const target = (weights: Record<string, number>, time: number, sourceId = `source:${time}`): SourcePortfolioTargets => ({
  weights, knownAtMs: time - DAY, executeAtMs: time, labelTimeMs: time - DAY, sourceId,
});
const marks = { BTCUSDT: '100', ETHUSDT: '100' };

describe('source momentum semantics', () => {
  it('keeps average ranks for ties, missing zero, market neutrality and gross 2', () => {
    const weights = sourceRankWeights({ a: 1, b: 1, c: 3, d: 4, missing: null });
    expect(weights).toEqual({ a: -0.5, b: -0.5, c: 0.25, d: 0.75, missing: 0 });
    expect(Object.values(weights).reduce((sum, weight) => sum + weight, 0)).toBe(0);
    expect(Object.values(weights).reduce((sum, weight) => sum + Math.abs(weight), 0)).toBe(2);
    expect(sourceRankWeights({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });

  it('uses sample volatility and the original additional day lag, ignoring future price changes', () => {
    const origin = Date.UTC(2026, 7, 1);
    const rows: DailyPriceRow[] = Array.from({ length: 50 }, (_, index) => ({ openTimeMs: origin + index * DAY,
      closes: Object.fromEntries(SOURCE_UNIVERSE.map((symbol, coin) => [symbol, 100 + (coin + 1) * index + (index % 3) * (coin % 7)])) }));
    const execute = origin + 42 * DAY;
    const result = buildSourceTargets(rows, execute);
    const changed = rows.map(row => ({ ...row, closes: { ...row.closes } }));
    // At execution42, latest signal close is labelled40; rows41+ are still excluded.
    for (const row of changed) if (row.openTimeMs > origin + 40 * DAY) row.closes.BTCUSDT = 10_000_000;
    expect(buildSourceTargets(changed, execute)).toEqual(result);
    expect(result.knownAtMs).toBe(origin + 41 * DAY);
    expect(result.labelTimeMs).toBe(origin + 41 * DAY);
    const signals: Record<string, number> = {};
    for (const symbol of SOURCE_UNIVERSE) {
      const returns = Array.from({ length: 30 }, (_, j) => Number(rows[11 + j].closes[symbol]) / Number(rows[10 + j].closes[symbol]) - 1);
      const mean = returns.reduce((sum, item) => sum + item, 0) / 30;
      const vol = Math.sqrt(returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / 29);
      signals[symbol] = (Number(rows[40].closes[symbol]) / Number(rows[26].closes[symbol]) - 1) / vol;
    }
    expect(result.weights).toEqual(sourceRankWeights(signals));
    expect(() => buildSourceTargets(rows, execute + 1)).toThrow('UTC midnight');
  });
});

describe('shared paper wallet execution and risk', () => {
  it('keeps inventory and executes only target deltas; realized+unrealized reconcile by hand', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'open', time: START, marks, targets: target({ BTCUSDT: 0.5, ETHUSDT: -0.5 }, START) });
    expect(engine.snapshot().positions.BTCUSDT.quantity).toBe('0.5');
    expect(engine.snapshot().positions.ETHUSDT.quantity).toBe('-0.5');
    const next = START + 60_000;
    const result = engine.step({ id: 'delta', time: next, marks: { ...marks, BTCUSDT: '120' }, targets: target({ BTCUSDT: 0.5, ETHUSDT: -0.5 }, next) });
    const fills = result.events.filter(event => event.kind === 'fill');
    expect(fills.map(event => [event.symbol, event.quantity])).toEqual([['BTCUSDT', '-0.04'], ['ETHUSDT', '-0.05']]);
    expect(engine.snapshot().cash).toBe('100.8');
    expect(engine.snapshot().equity).toBe('110');
    expect(engine.summary().unrealizedPnl).toBe('9.2');
    expect(engine.snapshot().fillCount).toBe(4);
  });

  it('closes old signs before opening reversed signs and never duplicates a rebalance after restart', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'open', time: START, marks, targets: target({ BTCUSDT: 0.5, ETHUSDT: -0.5 }, START) });
    const next = START + 1;
    const flipped = engine.step({ id: 'flip', time: next, marks, targets: target({ BTCUSDT: -0.5, ETHUSDT: 0.5 }, next) });
    expect(flipped.events.filter(event => event.kind === 'fill').map(event => event.reason)).toEqual(['target_reduce', 'target_reduce', 'target_increase', 'target_increase']);
    const restored = new PortfolioPaperEngine(config(), engine.snapshot());
    expect(restored.step({ id: 'flip', time: next, marks }).duplicate).toBe(true);
    expect(restored.step({ id: 'repeat-source', time: next, marks, targets: target({ BTCUSDT: -0.5, ETHUSDT: 0.5 }, next) }).events).toEqual([]);
    expect(restored.snapshot().fillCount).toBe(6);
  });

  it('books signed funding once even after restart and assigns boundary funding to the new ICT day', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'open', time: START, marks, targets: target({ BTCUSDT: 0.5, ETHUSDT: -0.5 }, START) });
    const boundary = START + DAY;
    const fund = [{ id: 'fund-1', symbol: 'BTCUSDT', rate: '0.01' }, { id: 'fund-2', symbol: 'ETHUSDT', rate: '0.02' }];
    engine.step({ id: 'midnight', time: boundary, marks, funding: fund });
    expect(engine.snapshot().fundingPnl).toBe('0.5');
    expect(engine.snapshot().days[0].netPnl).toBe('0');
    expect(engine.snapshot().currentDay?.netPnl).toBe('0.5');
    const restored = new PortfolioPaperEngine(config(), engine.snapshot());
    restored.step({ id: 'repeat-funding', time: boundary + 1, marks, funding: fund });
    expect(restored.snapshot().cash).toBe('100.5');
    expect(restored.snapshot().processedFundingIds).toHaveLength(2);
  });

  it('uses one fixed 10u daily budget across coins, cashflow-adjusted, with durable latch and truthful gap overshoot', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'open', time: START, marks, targets: target({ BTCUSDT: 0.5, ETHUSDT: -0.5 }, START) });
    const dropped = { BTCUSDT: '80', ETHUSDT: '105' };
    engine.step({ id: 'gap', time: START + 1, marks: dropped, cashflows: [{ id: 'deposit', amount: '100' }] });
    expect(engine.snapshot().equity).toBe('187.5');
    expect(engine.snapshot().currentDay?.netPnl).toBe('-12.5');
    expect(engine.snapshot().currentDay?.breachUsd).toBe('2.5');
    expect(engine.snapshot().positions).toEqual({});
    const restored = new PortfolioPaperEngine(config(), engine.snapshot());
    restored.step({ id: 'try-entry', time: START + 2, marks: dropped, targets: target({ BTCUSDT: 0.5 }, START + 2) });
    expect(restored.snapshot().positions).toEqual({});
    expect(restored.snapshot().currentDay?.riskLatched).toBe(true);
    expect(restored.summary().netPnl).toBe('-12.5');
    expect(restored.summary().maxDailyBreachUsd).toBe('2.5');
  });

  it('does not expand the daily budget to 10% after equity increases', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'init', time: START, marks, cashflows: [{ id: 'deposit', amount: '100' }] });
    engine.step({ id: 'next-day-open', time: START + DAY, marks, targets: target({ BTCUSDT: 0.5 }, START + DAY) });
    engine.step({ id: 'loss', time: START + DAY + 1, marks: { ...marks, BTCUSDT: '90' } });
    expect(engine.snapshot().currentDay?.netPnl).toBe('-10');
    expect(engine.snapshot().currentDay?.riskLatched).toBe(true);
    expect(engine.snapshot().positions).toEqual({});
  });

  it('fails closed for a missing midnight anchor and rejects malformed frames atomically', () => {
    const engine = new PortfolioPaperEngine(config());
    engine.step({ id: 'open', time: START, marks, targets: target({ BTCUSDT: 0.5 }, START) });
    const previous = engine.snapshot();
    expect(() => engine.step({ id: 'invalid', time: START + 1, marks: { ETHUSDT: '100' }, cashflows: [{ id: 'flow', amount: '9' }] })).toThrow('Missing current mark');
    expect(engine.snapshot()).toEqual(previous);
    engine.step({ id: 'missing-midnight', time: START + DAY + 1, marks });
    expect(engine.snapshot().currentDay?.anchorQuality).toBe('missing_midnight');
    expect(engine.snapshot().currentDay?.riskLatched).toBe(true);
    expect(engine.snapshot().positions).toEqual({});
  });

  it('projects an unexecutable BTC ticket to zero without silently raising it to one lot', () => {
    const engine = new PortfolioPaperEngine(config({ filters: { BTCUSDT: { stepSize: '0.001', minQty: '0.001', minNotional: '100' } } }));
    const result = engine.step({ id: 'tiny', time: START, marks: { BTCUSDT: '83000' }, targets: target({ BTCUSDT: 0.0175 }, START) });
    expect(engine.snapshot().positions).toEqual({});
    expect(engine.snapshot().targetQuantities.BTCUSDT).toBe('0');
    expect(result.events.find(event => event.kind === 'target')?.reason).toBe('nearest_zero_below_market_minimum');
  });

  it('allows a valid reduce-only quantity below opening minimum notional and includes close costs', () => {
    const engine = new PortfolioPaperEngine(config({ filters: { BTCUSDT: { stepSize: '0.01', minQty: '0.01', minNotional: '40' } }, feeRate: '0.001', slippageBps: '10' }));
    engine.step({ id: 'open', time: START, marks: { BTCUSDT: '100' }, targets: target({ BTCUSDT: 0.5 }, START) });
    const reduced = engine.step({ id: 'reduce', time: START + 1, marks: { BTCUSDT: '100' }, targets: target({ BTCUSDT: 0 }, START + 1) });
    expect(reduced.events.some(event => event.kind === 'fill' && event.quantity === '-0.5')).toBe(true);
    expect(engine.snapshot().positions).toEqual({});
    expect(engine.snapshot().totalFees).toBe('0.1');
    expect(engine.snapshot().cash).toBe('99.8');
    expect(engine.summary().realizedPnl).toBe('-0.1');
  });

  it('enforces post-cost source gross and margin, refuses config drift on restart, rejects future targets', () => {
    const engine = new PortfolioPaperEngine(config({ feeRate: '0.005' }));
    engine.step({ id: 'open', time: START, marks, targets: target({ BTCUSDT: 1, ETHUSDT: -1 }, START) });
    const state = engine.snapshot();
    expect(Number(state.grossNotional)).toBeLessThanOrEqual(2 * Number(state.equity));
    expect(() => new PortfolioPaperEngine(config({ feeRate: '0.006' }), state)).toThrow('config mismatch');
    expect(() => engine.step({ id: 'future', time: START + 1, marks, targets: { ...target({ BTCUSDT: 1 }, START + 1), knownAtMs: START + 2 } })).toThrow('future source targets');
    const margin = new PortfolioPaperEngine(config({ leverage: '0.5' }));
    margin.step({ id: 'margin', time: START, marks, targets: target({ BTCUSDT: 1 }, START) });
    expect(margin.snapshot().positions).toEqual({});
  });

  it('counts exactly fourteen completed ICT days at the final boundary', () => {
    const engine = new PortfolioPaperEngine(config());
    for (let index = 0; index <= 14; index++) engine.step({ id: `day-${index}`, time: START + index * DAY, marks });
    expect(engine.summary().calendarDays).toBe(14);
    expect(engine.summary().completedDays).toBe(14);
  });
  it('admits MARKET minimum by mark price and reports slippage without subtracting it twice', () => {
    const engine = new PortfolioPaperEngine(config({ filters: { BTCUSDT: { stepSize: '0.01', minQty: '0.01', minNotional: '40' } } }));
    engine.step({ id: 'minimum', time: START, marks: { BTCUSDT: '100' }, tradePrices: { BTCUSDT: '200' }, targets: target({ BTCUSDT: 0.3 }, START) });
    expect(engine.snapshot().positions).toEqual({});
    const costs = new PortfolioPaperEngine(config({ feeRate: '0.001', slippageBps: '10' }));
    costs.step({ id: 'entry', time: START, marks, targets: target({ BTCUSDT: 0.5 }, START) });
    costs.closeAll(START + 1, marks);
    expect(costs.summary().totalSlippage).toBe('0.1');
    expect(costs.summary().netPnl).toBe('-0.2');
  });
  it('makes delayed startup execution explicit while preserving its scheduled UTC source label', () => {
    const scheduled = Date.UTC(2026, 9, 1); const now = scheduled + 3_600_000;
    const engine = new PortfolioPaperEngine(config());
    expect(() => engine.step({ id: 'hidden-delay', time: now, marks, targets: target({ BTCUSDT: 0.5 }, scheduled) })).toThrow('Stale');
    engine.step({ id: 'explicit-delay', time: now, marks,
      targets: { ...target({ BTCUSDT: 0.5 }, scheduled), scheduledExecuteAtMs: scheduled, executeAtMs: now } });
    expect(engine.snapshot().lastTargets?.scheduledExecuteAtMs).toBe(scheduled);
    expect(engine.snapshot().lastTargets?.labelTimeMs).toBe(scheduled - DAY);
  });
});
