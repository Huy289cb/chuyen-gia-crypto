#!/usr/bin/env tsx
/** Deterministic fixture only; no historical market outcomes are read. */
import { strict as assert } from 'node:assert';
import { PortfolioPaperEngine } from '../src/portfolio/paper-engine';
import type { PortfolioPaperConfig, PortfolioPaperState, PortfolioPaperStep } from '../src/portfolio/types';

const start = Date.parse('2026-08-10T17:00:00Z');
const day = 86_400_000;
const cfg: PortfolioPaperConfig = { initialCash: '100', dailyLossLimitUsd: '10', feeRate: '0.0005', slippageBps: '2', leverage: '10', maintenanceRate: '0.005', closeBufferUsd: '0.10',
  filters: { BTCUSDT: { stepSize: '0.01', minQty: '0.01', minNotional: '1' }, ETHUSDT: { stepSize: '0.01', minQty: '0.01', minNotional: '1' } } };
const moneyState = (snapshot: PortfolioPaperState): Omit<PortfolioPaperState, 'processedStepIds'> => {
  const { processedStepIds: _identities, ...rest } = snapshot;
  return rest;
};
const full = new PortfolioPaperEngine(cfg);
let compact = new PortfolioPaperEngine(cfg);
const seen = new Set<string>();
let checks = 0;
for (let d = 0; d < 6; d += 1) {
  if (d > 0) {
    const state = compact.snapshot();
    state.processedStepIds = [];
    compact = new PortfolioPaperEngine(cfg, state);
    assert.deepEqual(moneyState(compact.snapshot()), moneyState(full.snapshot())); checks += 1;
  }
  const marks = { BTCUSDT: String(100 + d), ETHUSDT: String(101 - d) };
  const time = start + d * day;
  const sequence: PortfolioPaperStep[] = [
    { id: `d${d}:open`, time, marks, funding: [{ id: `f${d}`, symbol: 'BTCUSDT', rate: '0.001' }] },
    { id: `d${d}:fund-repeat`, time: time + 1, marks, funding: [{ id: `f${d}`, symbol: 'BTCUSDT', rate: '0.001' }] },
    { id: `d${d}:targets`, time: time + 2, marks, targets: { sourceId: `target${d}`, knownAtMs: time - day, executeAtMs: time + 2, labelTimeMs: time - day,
      weights: { BTCUSDT: d % 2 ? -0.5 : 0.5, ETHUSDT: d % 2 ? 0.5 : -0.5 } } },
    { id: `d${d}:close`, time: time + day - 1, marks: d === 2 ? { BTCUSDT: '50', ETHUSDT: '130' } : marks,
      ...(d === 5 ? { forceClose: 'fixture_terminal' } : {}) },
  ];
  for (const input of sequence) {
    assert(!seen.has(input.id)); seen.add(input.id);
    const a = full.step(input), b = compact.step(input);
    assert.deepEqual(a.events, b.events);
    assert.deepEqual(moneyState(a.snapshot), moneyState(b.snapshot));
    assert.deepEqual(full.summary(), compact.summary());
    checks += 3;
  }
}
assert.equal(compact.summary().calendarDays, 6);
assert(Number(compact.summary().maxDailyBreachUsd) > 0);
assert.equal(compact.snapshot().processedFundingIds.length, 6);
assert.deepEqual(compact.snapshot().positions, {});
const bad = compact.snapshot();
bad.cash = '200';
assert.throws(() => new PortfolioPaperEngine(cfg, bad), /MTM mismatch/);
console.log(JSON.stringify({ status: 'PASS', independentStateComparisons: checks, uniqueStepIds: seen.size, syntheticDays: 6,
  scope: 'Unpruned and offline midnight-restored engines have identical full monetary state/events/summary, funding dedup, latch and rollover. Only processedStepIds differ; no historical outcomes read.' }, null, 2));
