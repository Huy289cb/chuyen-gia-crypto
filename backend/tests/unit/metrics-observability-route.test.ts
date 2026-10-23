import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindAccount = vi.hoisted(() => vi.fn());
const mockFindSnapshots = vi.hoisted(() => vi.fn());
const mockFindOutcomes = vi.hoisted(() => vi.fn());
const mockFindEvents = vi.hoisted(() => vi.fn());
const mockFindDecisions = vi.hoisted(() => vi.fn());
const mockGetCircuit = vi.hoisted(() => vi.fn());

const policy = {
  riskPerTradePercent: 0.5,
  maxEffectiveRiskPerTradePercent: 2,
  minimumLotStopNormalizationEnabled: false,
  minimumLotNormalizedStopMaxPercent: 0.0084,
  dailyLossLimitPercent: 2,
  maxDrawdownPercent: 15,
  circuitDailyLossEnabled: true,
  circuitDrawdownEnabled: true,
  circuitExpectancyKillEnabled: true,
  circuitExpectancyWindow: 2,
  circuitExpectancyMinSumR: -3,
  circuitExpectancySince: new Date('2026-08-12T00:00:00Z'),
};

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: { findFirst: mockFindAccount },
    testnetAccountSnapshot: { findMany: mockFindSnapshots },
    tradeOutcome: { findMany: mockFindOutcomes },
    testnetTradeEvent: { findMany: mockFindEvents },
    tradeDecision: { findMany: mockFindDecisions },
  },
}));

vi.mock('../../src/config/risk-policy', () => ({ getRiskPolicy: () => policy }));
vi.mock('../../src/services/account-circuit.service', () => ({
  getAccountCircuitStatus: mockGetCircuit,
}));
vi.mock('../../src/services/risk-manager.service', () => ({
  riskManagerService: {
    getConfig: () => ({
      riskPerTradePercent: 0.5,
      maxConsecutiveLosses: 3,
      consecutiveLossCooldownHours: 4,
      maxSpreadPercent: 0.05,
      maxSlippagePercent: 0.1,
      maxFeePercent: 0.1,
      minSignalGrade: 'A',
      minSignalConfidence: 0.75,
      maxPositionsPerSymbol: 1,
      maxTotalPositions: 2,
    }),
  },
}));
vi.mock('../../src/services/memory.service', () => ({ memoryService: {} }));
vi.mock('../../src/services/signal-gate.service', () => ({ signalGateService: {} }));

import metricsRouter from '../../src/routes/metrics';

async function invoke(path: string, query: Record<string, string> = {}) {
  const layer = (metricsRouter as any).stack.find(
    (candidate: any) => candidate.route?.path === path
  );
  let status = 200;
  let body: any;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  };
  await layer.route.stack[0].handle({ query }, res, vi.fn());
  return { status, body };
}

describe('/api/metrics observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindAccount.mockResolvedValue({
      id: 1,
      starting_balance: 40,
      current_balance: 32,
      equity: 32,
    });
    mockFindSnapshots.mockResolvedValue([
      { balance: 40, equity: 40, timestamp: new Date('2026-07-01T00:00:00Z') },
      { balance: 50, equity: 50, timestamp: new Date('2026-08-01T00:00:00Z') },
      { balance: 32, equity: 32, timestamp: new Date('2026-08-14T00:00:00Z') },
    ]);
    mockGetCircuit.mockResolvedValue({
      scope: 'strategy_epoch',
      epochStart: policy.circuitExpectancySince,
      peakEquitySource: 'override',
      expectancySince: policy.circuitExpectancySince,
      allowed: true,
      reason: 'circuits clear',
      dailyLossUsd: 0,
      dailyLossPercent: 0,
      dailyLossLimitPercent: 2,
      peakEquity: 36,
      drawdownPercent: 11.11,
      maxDrawdownPercent: 15,
      expectancy: { n: 2, sumR: 1, avgR: 0.5, profitFactor: 2 },
    });
    mockFindOutcomes.mockResolvedValue([
      {
        realized_rr: 2,
        realized_pnl: 2,
        close_reason: 'take_profit',
        timestamp: new Date('2026-08-14T00:00:00Z'),
      },
      {
        realized_rr: -1,
        realized_pnl: -1,
        close_reason: 'stop_loss',
        timestamp: new Date('2026-08-13T00:00:00Z'),
      },
      {
        realized_rr: -1,
        realized_pnl: -1,
        close_reason: 'stop_loss',
        timestamp: new Date('2026-07-01T00:00:00Z'),
      },
    ]);
    mockFindEvents.mockResolvedValue([]);
    mockFindDecisions.mockResolvedValue([]);
  });

  it('reports unknown AI costs and never labels technical validation as proven ROI', async () => {
    mockFindEvents.mockResolvedValue([
      { event_type: 'ai_opportunity_claim', event_data: '{}' },
      { event_type: 'ai_opportunity_claim', event_data: '{}' },
      { event_type: 'ai_opportunity_claim', event_data: '{}' },
      { event_type: 'ai_opportunity_review', event_data: JSON.stringify({ cost_usd: .002, raw_content: 'private' }) },
      { event_type: 'ai_opportunity_review', event_data: JSON.stringify({ cost_usd: null }) },
    ]);
    const { status, body } = await invoke('/ai-opportunity');
    expect(status).toBe(200);
    expect(body.known_cost_usd).toBe(.002);
    expect(body.unknown_cost_reviews).toBe(1);
    expect(body.claims_without_review).toBe(1);
    expect(body.roi_proven).toBe(false);
    expect(JSON.stringify(body)).not.toContain('private');
  });

  it('exposes sizing target/cap plus separate wallet and strategy-epoch drawdowns', async () => {
    const response = await invoke('/risk');

    expect(response.status).toBe(200);
    expect(response.body.config.risk_per_trade_percent).toBe(0.5);
    expect(response.body.config.max_effective_risk_per_trade_percent).toBe(2);
    expect(response.body.config.minimum_lot_stop_normalization_enabled).toBe(false);
    expect(response.body.config.minimum_lot_normalized_stop_max_percent).toBe(0.0084);
    expect(response.body.full_history.wallet_pnl).toBe(-8);
    expect(response.body.full_history.max_drawdown_percent).toBe(36);
    expect(response.body.strategy_epoch.drawdown_percent).toBe(11.11);
    expect(response.body.strategy_epoch.trading_allowed).toBe(true);
  });

  it('separates full-history expectancy from the circuit window', async () => {
    const response = await invoke('/expectancy', { n: '20' });

    expect(response.status).toBe(200);
    expect(response.body.full_history.scope).toBe('full_history');
    expect(response.body.full_history.n).toBe(3);
    expect(response.body.strategy_epoch.scope).toBe('strategy_epoch');
    expect(response.body.strategy_epoch.n).toBe(2);
    expect(response.body.strategy_epoch.sumR).toBe(1);
  });

  it('deduplicates gate observations and reports every blocking gate', async () => {
    const observation = {
      observation_key: 'BTC:15m:bar:v2:1',
      symbol: 'BTC',
      timeframe: '15m',
      grade: 'B',
      playbook: 'breakout_volume',
      side: 'long',
      gates: {
        structure: { status: 'block', reason: 'transition' },
        htf_side_align: { status: 'block', reason: 'range' },
      },
      first_block: 'structure',
      all_blocks: ['structure', 'htf_side_align'],
      would_pass_pre_llm: false,
    };
    mockFindEvents.mockResolvedValue([
      { id: 1, event_type: 'gate_funnel_shadow', event_data: JSON.stringify(observation), timestamp: new Date() },
      { id: 2, event_type: 'gate_funnel_shadow', event_data: JSON.stringify(observation), timestamp: new Date() },
    ]);

    const response = await invoke('/gate-funnel', { symbol: 'BTC', days: '7' });

    expect(response.status).toBe(200);
    expect(response.body.unique_candidates).toBe(1);
    expect(response.body.duplicate_events).toBe(1);
    expect(response.body.first_blocks.structure).toBe(1);
    expect(response.body.all_blocks.htf_side_align).toBe(1);
  });

  it('reports shadow retest lifecycle and gross-R expectancy separately', async () => {
    const base = {
      candidate_key: 'BTC:15m:long:bar:v2:1',
      symbol: 'BTC',
      timeframe: '15m',
      grade: 'B',
      side: 'long',
    };
    mockFindEvents.mockResolvedValue([
      { id: 1, event_type: 'transition_retest_candidate', event_data: JSON.stringify(base), timestamp: new Date('2026-08-29T00:00:00Z') },
      { id: 2, event_type: 'transition_retest_confirmed', event_data: JSON.stringify(base), timestamp: new Date('2026-08-29T01:00:00Z') },
      { id: 3, event_type: 'transition_retest_shadow_outcome', event_data: JSON.stringify({ ...base, close_reason: 'take_profit', realized_r_gross: 3 }), timestamp: new Date('2026-08-29T02:00:00Z') },
    ]);

    const response = await invoke('/transition-retest', { symbol: 'BTC', days: '30' });

    expect(response.status).toBe(200);
    expect(response.body.execution).toBe('shadow_only');
    expect(response.body.candidates).toBe(1);
    expect(response.body.confirmed).toBe(1);
    expect(response.body.active_shadow_positions).toBe(0);
    expect(response.body.outcome_reasons.take_profit).toBe(1);
    expect(response.body.gross_r).toMatchObject({ n: 1, sum_r: 3, avg_r: 3, wins: 1 });
    expect(response.body.gross_r.profit_factor).toBeNull();
  });
});
