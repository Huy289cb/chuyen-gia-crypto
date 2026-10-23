import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eligibility: vi.fn(),
  hasEvent: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock('../../src/services/v3-entry-eligibility.service', () => ({
  canRunLlmDispatchForSymbol: mocks.eligibility,
}));
vi.mock('../../src/repositories/testnet.repository', () => ({
  hasSilentPipelineEventKey: mocks.hasEvent,
  recordSilentPipelineEvent: mocks.recordEvent,
}));

import type { SignalGateOutput } from '../../src/services/signal-gate.service';
import {
  clearEntryGateFunnelDedupForTests,
  evaluateEntryGateFunnel,
  recordEntryGateFunnel,
} from '../../src/services/entry-gate-funnel.service';

function candles(lastClose = 102) {
  const start = Date.UTC(2026, 7, 29, 0, 0, 0);
  return Array.from({ length: 30 }, (_, index) => ({
    timestamp: start + index * 15 * 60_000,
    open: 100,
    high: index === 29 ? lastClose + 0.5 : 101,
    low: 99,
    close: index === 29 ? lastClose : 100,
    volume: index === 29 ? 300 : 100,
  }));
}

function signal(): SignalGateOutput {
  return {
    pass: true,
    shouldCallGroq: true,
    isDuplicate: false,
    reason: 'pass',
    gateRegime: 'trend',
    setupResult: {
      playbookKey: 'breakout_volume',
      grade: 'B',
      confidence: 0.7,
      regime: 'trend',
      reason: 'moderate breakout',
      detailReason: 'test',
      evidence: {
        symbol: 'BTC',
        timeframe: '15m',
        candleCount: 30,
        lastCandleTime: candles().at(-1)!.timestamp,
        price: 102,
        regime: {
          regime: 'trend',
          volatilityPct: 1,
          trendStrengthPct: 1,
          rangePct: 2,
          avgPrice: 100,
          currentPrice: 102,
          matchedRule: 'trend',
          trendDirection: 'bullish',
        },
        playbooks: [
          {
            playbook: 'breakout_volume',
            detected: true,
            grade: 'B',
            summary: 'breakout',
            metrics: { resistance: 101, volumeRatio: 1.8, breakoutStrengthPct: 0.7 },
          },
        ],
      },
    },
  };
}

describe('entry gate funnel', () => {
  beforeEach(() => {
    vi.stubEnv('MIN_SIGNAL_GRADE', 'B');
    vi.stubEnv('MIN_SIGNAL_CONFIDENCE', '0.70');
    vi.stubEnv('V3_GRADE_B_MIN_CONFIDENCE', '0.70');
    vi.stubEnv('V3_GRADE_B_ALLOWED_PLAYBOOKS', 'breakout_volume');
    vi.stubEnv('V3_STRUCTURE_BIAS_ENABLED', 'false');
    vi.stubEnv('V3_REQUIRE_HTF_TREND', 'false');
    vi.stubEnv('V3_REQUIRE_HTF_SIDE_ALIGN', 'false');
    vi.stubEnv('V3_REQUIRE_PULLBACK', 'false');
    vi.stubEnv('FUNDING_VETO_ENABLED', 'false');
    mocks.eligibility.mockResolvedValue({ allowed: true, reason: 'ok' });
    mocks.hasEvent.mockResolvedValue(false);
    mocks.recordEvent.mockResolvedValue(1);
    clearEntryGateFunnelDedupForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('evaluates every deterministic gate without blocking a valid observation', async () => {
    const result = await evaluateEntryGateFunnel({
      symbol: 'BTC',
      timeframe: '15m',
      candles: candles(),
      signalResult: signal(),
      getScan: () => undefined,
    });

    expect(result.side).toBe('long');
    expect(result.setup_identity?.status).toBe('unknown');
    expect(result.gates.structure.status).toBe('not_applicable');
    expect(result.gates.grade_playbook.status).toBe('pass');
    expect(result.first_block).toBeNull();
    expect(result.would_pass_pre_llm).toBe(true);
    expect(result.reject_cohort).toBe('pass');
    expect(result.day_key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('persists known anchor identity through the observation payload', async () => {
    const measured = signal();
    measured.setupResult.evidence.playbooks[0].metrics = {
      ...measured.setupResult.evidence.playbooks[0].metrics,
      detectorVersion: 'breakout_volume_v1',
      anchorHighOpenTime: candles()[0].timestamp,
      anchorLowOpenTime: candles()[0].timestamp,
      anchorWindowEndOpenTime: candles()[24].timestamp,
      detectionOpenTime: candles()[29].timestamp,
    };
    const result = await recordEntryGateFunnel({ symbol: 'BTC', timeframe: '15m',
      candles: candles(), signalResult: measured, getScan: () => undefined });
    expect(result?.setup_identity?.status).toBe('known');
    expect(result?.setup_identity?.wave_id).toBeNull();
    expect(JSON.stringify(mocks.recordEvent.mock.calls)).toContain(result!.setup_identity!.setup_id!);
  });

  it('maps pullback / grade / feasibility into reject cohorts', async () => {
    const { classifyFunnelRejectCohorts } = await import(
      '../../src/services/entry-gate-funnel.service'
    );
    const blocked = classifyFunnelRejectCohorts({
      all_blocks: ['pullback_proxy', 'structure'],
      first_block: 'pullback_proxy',
      feasibilityStatus: 'target_room',
    });
    expect(blocked.primary).toBe('pullback');
    expect(blocked.cohorts).toEqual(expect.arrayContaining(['pullback', 'structure', 'target_room']));
    expect(blocked.feasibility_cohort).toBe('target_room');

    const rrOnly = classifyFunnelRejectCohorts({
      all_blocks: [],
      first_block: null,
      feasibilityStatus: 'rr',
    });
    expect(rrOnly.primary).toBe('rr');
    expect(rrOnly.cohorts).toContain('rr');
  });

  it('persists only once when OHLC changes on the same bar timestamp', async () => {
    const first = candles();
    const revised = candles(103);
    const base = {
      symbol: 'BTC',
      timeframe: '15m',
      signalResult: signal(),
      getScan: () => undefined,
    };
    expect(await recordEntryGateFunnel({ ...base, candles: first })).not.toBeNull();
    expect(await recordEntryGateFunnel({ ...base, candles: revised })).toBeNull();
    expect(mocks.recordEvent).toHaveBeenCalledOnce();
  });
});
