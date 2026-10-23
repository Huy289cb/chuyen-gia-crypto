import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('../../src/services/openrouter-client', () => ({ analyzeViaOpenRouter: mocks.analyze }));

import {
  buildRiskVetoPlanSnapshot, observeRiskVetoShadow, parseRiskVetoResponse,
  resetRiskVetoShadowStateForTests, type RiskVetoObservation, type RiskVetoPlanSnapshot,
} from '../../src/services/openrouter-risk-veto-shadow.service';
import { observeLiveRiskVetoShadow } from '../../src/portfolio/live-risk-veto-shadow';
import {
  dailyCloseLookupFromCsv, evaluateRiskVetoShadow, parseRiskVetoObservationsNdjson,
} from '../../src/portfolio/risk-veto-shadow-eval';
import type { SourcePortfolioTargets } from '../../src/portfolio/types';

const DAY = 86_400_000;
const EXECUTE = Date.UTC(2026, 9, 20);
const rows = Array.from({ length: 40 }, (_, i) => ({
  openTimeMs: EXECUTE - (40 - i) * DAY,
  closes: { BTCUSDT: 100 + i, ETHUSDT: 50 - i * 0.5 },
}));
const target = (): SourcePortfolioTargets => ({
  weights: { BTCUSDT: 0.6, ETHUSDT: -0.3 }, decimalWeights: { BTCUSDT: '0.6', ETHUSDT: '-0.3' },
  knownAtMs: EXECUTE, executeAtMs: EXECUTE, labelTimeMs: EXECUTE - DAY, sourceId: 'src-1',
  policyId: 'CONSTANT_DIRECTION_B5_S6_DAILY15_V1',
  metadata: { BTCUSDT: { signalCountChanged: false, annVol90: 0.5 }, ETHUSDT: { signalCountChanged: false, annVol90: 0.7 } },
});
const goodResponse = { verdicts: [
  { symbol: 'BTCUSDT', action: 'keep', sizeMultiplier: 1, confidence: 0.9, reasonCode: 'none', shortReason: 'ok' },
  { symbol: 'ETHUSDT', action: 'reduce', sizeMultiplier: 0.5, confidence: 0.7, reasonCode: 'extreme_funding', shortReason: 'funding' },
] };

describe('openrouter risk veto shadow', () => {
  const originalEnv = { ...process.env };
  let persisted: RiskVetoObservation[];
  const persist = async (o: RiskVetoObservation) => { persisted.push(o); };

  beforeEach(() => {
    persisted = [];
    resetRiskVetoShadowStateForTests();
    process.env.OPENROUTER_RISK_VETO_SHADOW_MODEL = 'test/model';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('flag off: no model call and nothing persisted', async () => {
    delete process.env.OPENROUTER_RISK_VETO_SHADOW;
    const analyze = vi.fn();
    expect(await observeLiveRiskVetoShadow(target(), rows, { analyze, persist })).toBeNull();
    const plan = buildRiskVetoPlanSnapshot({ target: target(), closedDailyRows: rows });
    expect(await observeRiskVetoShadow(plan, { analyze, persist })).toBeNull();
    expect(analyze).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(0);
  });

  it('flag on: calls the client once with the plan and records verdicts', async () => {
    process.env.OPENROUTER_RISK_VETO_SHADOW = 'true';
    mocks.analyze.mockResolvedValue(goodResponse);
    const observation = await observeLiveRiskVetoShadow(target(), rows, { persist });
    // Same source day is observed at most once per process.
    expect(await observeLiveRiskVetoShadow(target(), rows, { persist })).toBeNull();
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    const request = mocks.analyze.mock.calls[0]![0];
    expect(request).toMatchObject({ model: 'test/model', responseFormat: 'json_object', maxParseRetries: 1 });
    const prompt = JSON.parse(request.userPrompt);
    expect(prompt.legs.map((l: { symbol: string; side: string; targetWeight: number }) => [l.symbol, l.side, l.targetWeight]))
      .toEqual([['BTCUSDT', 'long', 0.6], ['ETHUSDT', 'short', -0.3]]);
    expect(observation).toMatchObject({ valid: true, logOnly: true, model: 'test/model', decisionTimeMs: EXECUTE });
    expect(observation!.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(observation!.plan.legs[0]).toMatchObject({ symbol: 'BTCUSDT', price: 139, annVol90: 0.5 });
    expect(observation!.verdicts.map(v => [v.symbol, v.sizeMultiplier])).toEqual([['BTCUSDT', 1], ['ETHUSDT', 0.5]]);
    expect(persisted).toEqual([observation]);
  });

  it('appends durable NDJSON to the configured research directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'risk-veto-'));
    try {
      process.env.OPENROUTER_RISK_VETO_SHADOW = 'true';
      process.env.OPENROUTER_RISK_VETO_SHADOW_DIR = dir;
      const plan = buildRiskVetoPlanSnapshot({ target: target(), closedDailyRows: rows });
      await observeRiskVetoShadow(plan, { analyze: async () => goodResponse });
      await observeRiskVetoShadow(plan, { analyze: async () => 'garbage' });
      const parsed = parseRiskVetoObservationsNdjson(await readFile(path.join(dir, 'observations.ndjson'), 'utf8'));
      expect(parsed.map(o => o.valid)).toEqual([true, false]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('malformed JSON is recorded invalid and never thrown', async () => {
    process.env.OPENROUTER_RISK_VETO_SHADOW = 'true';
    const plan = buildRiskVetoPlanSnapshot({ target: target(), closedDailyRows: rows });
    const observation = await observeRiskVetoShadow(plan, { analyze: async () => '{"verdicts": [ {"symbol": "BTC', persist });
    expect(observation).toMatchObject({ valid: false, invalidReasons: ['unparseable_json'], verdicts: [] });
    expect(persisted).toHaveLength(1);
  });

  it('validates enums and clamps numbers', () => {
    const plan = buildRiskVetoPlanSnapshot({ target: target(), closedDailyRows: rows });
    const { verdicts, invalidReasons } = parseRiskVetoResponse(JSON.stringify({ verdicts: [
      { symbol: 'btcusdt', action: 'reduce', sizeMultiplier: 3, confidence: 85, reasonCode: 'news_event', shortReason: 'x'.repeat(400) },
      { symbol: 'ETHUSDT', action: 'veto', sizeMultiplier: 0.9, confidence: 0.5, reasonCode: 'moon', shortReason: '' },
      { symbol: 'DOGEUSDT', action: 'keep', sizeMultiplier: 1, confidence: 1, reasonCode: 'none', shortReason: '' },
    ] }), plan);
    expect(verdicts).toEqual([expect.objectContaining({ symbol: 'BTCUSDT', sizeMultiplier: 1, confidence: 0.85 })]);
    expect(verdicts[0]!.shortReason).toHaveLength(160);
    expect(invalidReasons).toEqual(['bad_reason_code:ETHUSDT', 'unknown_symbol:DOGEUSDT', 'missing_symbol:ETHUSDT']);
  });

  it('client throw or timeout leaves the prepared plan identical and resolves', async () => {
    process.env.OPENROUTER_RISK_VETO_SHADOW = 'true';
    const live = target();
    const before = structuredClone(live);
    const thrown = await observeLiveRiskVetoShadow(live, rows, {
      persist, analyze: () => { throw new Error('boom'); } });
    expect(thrown).toMatchObject({ valid: false, error: 'boom', invalidReasons: ['provider_error'] });

    resetRiskVetoShadowStateForTests();
    const hung = await observeLiveRiskVetoShadow(live, rows, {
      persist, timeoutMs: 20, analyze: () => new Promise(() => {}) });
    expect(hung).toMatchObject({ valid: false, error: 'risk_veto_shadow_timeout_20ms' });
    expect(live).toEqual(before);

    resetRiskVetoShadowStateForTests();
    // Even a failing persistence layer never surfaces to the caller.
    await expect(observeLiveRiskVetoShadow(live, rows, {
      analyze: async () => goodResponse, persist: async () => { throw new Error('disk full'); } })).resolves.toBeNull();
    expect(live).toEqual(before);
  });
});

describe('risk veto offline evaluator', () => {
  const plan: RiskVetoPlanSnapshot = { policyId: null, sourceId: 's', knownAtMs: EXECUTE, executeAtMs: EXECUTE, legs: [
    { symbol: 'BTCUSDT', side: 'long', weight: 0.5, price: 100, return1d: null, return7d: null, return30d: null, realizedVol30: null, annVol90: null },
    { symbol: 'ETHUSDT', side: 'short', weight: -0.4, price: 50, return1d: null, return7d: null, return30d: null, realizedVol30: null, annVol90: null },
    { symbol: 'SOLUSDT', side: 'long', weight: 0.2, price: 10, return1d: null, return7d: null, return30d: null, realizedVol30: null, annVol90: null },
  ] };
  const observation = (valid: boolean): RiskVetoObservation => ({
    schema: 'openrouter-risk-veto-shadow-v1', logOnly: true, observedAt: '', decisionTimeMs: EXECUTE, model: 'm',
    promptHash: 'h', latencyMs: 1, valid, invalidReasons: [], error: null, plan, verdicts: [
      { symbol: 'BTCUSDT', action: 'keep', sizeMultiplier: 1, confidence: 1, reasonCode: 'none', shortReason: '' },
      { symbol: 'ETHUSDT', action: 'veto', sizeMultiplier: 0, confidence: 1, reasonCode: 'news_event', shortReason: '' },
      { symbol: 'SOLUSDT', action: 'reduce', sizeMultiplier: 0.5, confidence: 1, reasonCode: 'exchange_risk', shortReason: '' },
    ] });

  it('computes counterfactual PnL of applying multipliers over the next day', () => {
    // Row 2026-10-20 closes at 2026-10-21 00:00 = executeAt + 24h.
    const lookup = dailyCloseLookupFromCsv('date,BTCUSDT,ETHUSDT,SOLUSDT\n2026-10-19,100,50,10\n2026-10-20,110,55,9\n');
    expect(lookup('BTCUSDT', EXECUTE + DAY)).toBe(110);
    const result = evaluateRiskVetoShadow([observation(true), observation(false)], lookup);
    // BTC keep: .5*.1=.05; ETH short veto: -.4*.1=-.04 base, 0 applied; SOL reduce: .2*-.1=-.02 base, -.01 applied.
    expect(result.validObservations).toBe(1);
    expect(result.skippedObservations).toBe(1);
    expect(result.basePnl).toBeCloseTo(-0.01, 12);
    expect(result.appliedPnl).toBeCloseTo(0.04, 12);
    expect(result.deltaPnl).toBeCloseTo(0.05, 12);
    expect(result.byAction.veto).toMatchObject({ legs: 1 });
    expect(result.byAction.veto.deltaPnl).toBeCloseTo(0.04, 12);
    expect(result.byAction.reduce.deltaPnl).toBeCloseTo(0.01, 12);
    expect(result.byAction.keep.deltaPnl).toBe(0);
  });

  it('skips legs without a later price', () => {
    const result = evaluateRiskVetoShadow([observation(true)], (symbol) => symbol === 'BTCUSDT' ? 90 : null);
    expect(result.skippedLegs).toBe(2);
    expect(result.basePnl).toBeCloseTo(-0.05, 12);
  });
});
