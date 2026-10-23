import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  getEvents: vi.fn(),
  hasEvent: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock('../../src/repositories/testnet.repository', () => ({
  getSilentPipelineEvents: repo.getEvents,
  hasSilentPipelineEventKey: repo.hasEvent,
  recordSilentPipelineEvent: repo.recordEvent,
}));

import type { EntryGateFunnelObservation } from '../../src/services/entry-gate-funnel.service';
import {
  getTransitionResolutionTtlMinutes,
  getTransitionRetestGrades,
  getTransitionRetestMinGrade,
  isTransitionRetestGradeEligible,
} from '../../src/config/transition-retest-policy';
import {
  claimTransitionRetestOpportunity,
  getTransitionRetestStateForTests,
  peekTransitionRetestOpportunity,
  processTransitionRetestScan,
  registerTransitionRetestCandidate,
  resetTransitionRetestStateForTests,
} from '../../src/services/transition-breakout-retest.service';

function buildBullSeries() {
  const out: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> = [];
  let timestamp = Date.UTC(2026, 7, 1);
  const add = (high: number, low: number, close: number) => {
    out.push({ timestamp, open: close, high, low, close, volume: 1 });
    timestamp += 3_600_000;
  };
  const pad = (n: number, mid: number) => {
    for (let i = 0; i < n; i++) add(mid + 2, mid - 2, mid);
  };
  pad(4, 105);
  add(108, 90, 96);
  pad(4, 110);
  add(130, 118, 125);
  pad(4, 120);
  add(122, 105, 112);
  pad(4, 125);
  add(150, 135, 145);
  pad(4, 140);
  return out;
}

function observation(barMs: number): EntryGateFunnelObservation {
  return {
    schema_version: 1,
    observation_key: `BTC:15m:kim_nghia:bar:v2:${barMs}`,
    bar_key: `bar:v2:${barMs}`,
    symbol: 'BTC',
    timeframe: '15m',
    evaluated_at: new Date().toISOString(),
    grade: 'B',
    confidence: 0.7,
    playbook: 'breakout_volume',
    side: 'long',
    local_regime: 'range',
    gate_regime: 'trend',
    first_block: 'structure',
    all_blocks: ['structure'],
    would_pass_pre_llm: false,
    structure_bias: 'transition',
    structure_detail: {
      bias: 'transition',
      swingHighs: [100, 110],
      swingLows: [95, 90],
      reason: 'mixed swings',
    },
    breakout_metrics: {
      resistance: 100,
      volumeRatio: 1.8,
      breakoutStrengthPct: 0.7,
    },
    gates: {},
  };
}

function candle(timestamp: number, close: number, low = close - 0.2, high = close + 0.2) {
  return [{ timestamp, open: close, high, low, close, volume: 1 }];
}

function htfScan() {
  return {
    timestamp: new Date(),
    candles: buildBullSeries(),
    signalResult: {
      pass: false,
      shouldCallGroq: false,
      isDuplicate: false,
      reason: 'htf state',
      setupResult: {
        playbookKey: null,
        grade: 'D' as const,
        confidence: 0,
        regime: 'trend' as const,
        reason: 'trend',
        detailReason: 'trend',
        evidence: {
          symbol: 'BTC', timeframe: '1h', candleCount: 30, lastCandleTime: 1, price: 140,
          regime: {
            regime: 'trend' as const, volatilityPct: 1, trendStrengthPct: 1, rangePct: 1,
            avgPrice: 120, currentPrice: 140, matchedRule: 'trend', trendDirection: 'bullish' as const,
          },
          playbooks: [],
        },
      },
    },
  };
}

function rangeScan() {
  const candles = Array.from({ length: 24 }, (_, index) => ({
    timestamp: Date.now() - (24 - index) * 3_600_000,
    open: 100,
    high: index % 2 ? 110 : 108,
    low: index % 2 ? 92 : 90,
    close: 100,
    volume: 1,
  }));
  const base = htfScan().signalResult;
  return {
    timestamp: new Date(),
    candles,
    signalResult: {
      ...base,
      pass: true,
      shouldCallGroq: true,
      gateRegime: 'range' as const,
      setupResult: {
        ...base.setupResult,
        playbookKey: 'liquidity_sweep_reclaim',
        grade: 'A' as const,
        confidence: 0.85,
        regime: 'range' as const,
        evidence: {
          ...base.setupResult.evidence,
          regime: {
            ...base.setupResult.evidence.regime,
            regime: 'range' as const,
            trendDirection: null,
          },
          playbooks: [{
            playbook: 'liquidity_sweep' as const,
            detected: true,
            grade: 'A' as const,
            summary: 'low sweep reclaim',
            metrics: { priorLow19: 91, priorHigh19: 109, lowSweep: true },
          }],
        },
      },
    },
  };
}

describe('transition breakout retest shadow', () => {
  beforeEach(() => {
    vi.stubEnv('V3_TRANSITION_RETEST_MODE', 'shadow');
    vi.stubEnv('V3_ADAPTIVE_SETUP_MODE', 'shadow');
    vi.stubEnv('V3_EARLY_STRUCTURE_FLIP_ENABLED', 'true');
    vi.stubEnv('V3_ALIGNED_MICRO_BOS_ENABLED', 'true');
    vi.stubEnv('V3_RANGE_SWEEP_RECLAIM_ENABLED', 'true');
    vi.stubEnv('V3_TRANSITION_RESOLUTION_ENABLED', 'false');
    vi.stubEnv('V3_TRANSITION_RESOLUTION_TTL_MINUTES', '180');
    vi.stubEnv('V3_TRANSITION_RETEST_MIN_GRADE', 'B');
    vi.stubEnv('V3_TRANSITION_RETEST_TTL_MINUTES', '45');
    vi.stubEnv('V3_TRANSITION_RETEST_TOLERANCE_PCT', '0.15');
    vi.stubEnv('V3_TRANSITION_RETEST_INVALIDATION_PCT', '0.25');
    vi.stubEnv('V3_TRANSITION_RETEST_REQUIRE_HTF_TF', '1h');
    vi.stubEnv('V3_TRANSITION_RETEST_REQUIRE_BOS', 'true');
    vi.stubEnv('MIN_SL_DISTANCE_PERCENT', '0.008');
    vi.stubEnv('MIN_RR_RATIO', '3');
    repo.getEvents.mockResolvedValue([]);
    repo.hasEvent.mockResolvedValue(false);
    repo.recordEvent.mockResolvedValue(1);
    resetTransitionRetestStateForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('treats minimum grade B as A-or-B, while rejecting C and D', () => {
    expect(getTransitionRetestMinGrade()).toBe('B');
    expect(getTransitionRetestGrades()).toEqual(['A', 'B']);
    expect(isTransitionRetestGradeEligible('A')).toBe(true);
    expect(isTransitionRetestGradeEligible('B')).toBe(true);
    expect(isTransitionRetestGradeEligible('C')).toBe(false);
    expect(isTransitionRetestGradeEligible('D')).toBe(false);
    expect(getTransitionResolutionTtlMinutes()).toBe(180);
  });

  it('registers a shadow-only long after mixed 4h structure resolves with fresh 1h alignment', async () => {
    vi.stubEnv('V3_TRANSITION_RETEST_MODE', 'live');
    vi.stubEnv('V3_TRANSITION_RESOLUTION_ENABLED', 'true');
    const breakoutMs = Date.UTC(2026, 8, 4, 12, 0, 0);
    const obs = observation(breakoutMs);
    obs.all_blocks = ['structure', 'pullback_proxy', 'account_eligibility'];
    obs.gates = {
      structure: { status: 'block', reason: 'mixed 4h structure' },
      htf_trend: { status: 'pass' },
      side_align: {
        status: 'pass',
        observed: { htf_tf: '1h', regime: 'trend', trend_direction: 'bullish' },
      },
      pullback_proxy: { status: 'block', reason: 'breakout extended' },
      account_eligibility: { status: 'block', reason: 'expectancy cooldown' },
    };

    const created = await registerTransitionRetestCandidate(
      obs,
      candle(breakoutMs, 101),
      undefined,
      breakoutMs
    );

    expect(created).toMatchObject({
      candidate_kind: 'transition_resolution',
      mode: 'shadow',
      resolution_evidence: {
        prior_swing_price: 100,
        latest_swing_price: 110,
        htf_timeframe: '1h',
        htf_direction: 'bullish',
      },
    });
    expect(Date.parse(created!.expires_at) - breakoutMs).toBe(180 * 60_000);
    expect(peekTransitionRetestOpportunity('BTC', breakoutMs)).toBeNull();
  });

  it('rejects unresolved or HTF-opposed transition impulses', async () => {
    vi.stubEnv('V3_TRANSITION_RESOLUTION_ENABLED', 'true');
    const breakoutMs = Date.UTC(2026, 8, 4, 12, 0, 0);
    const obs = observation(breakoutMs);
    obs.all_blocks = ['structure', 'side_align'];
    obs.gates = {
      structure: { status: 'block' },
      htf_trend: { status: 'pass' },
      side_align: {
        status: 'block',
        observed: { regime: 'trend', trend_direction: 'bearish' },
      },
    };

    expect(
      await registerTransitionRetestCandidate(obs, candle(breakoutMs, 101), undefined, breakoutMs)
    ).toBeNull();

    obs.all_blocks = ['structure'];
    obs.gates.side_align = {
      status: 'pass',
      observed: { regime: 'trend', trend_direction: 'bullish' },
    };
    // Below the prior 4h swing high (100): structure has not resolved upward.
    expect(
      await registerTransitionRetestCandidate(obs, candle(breakoutMs, 99), undefined, breakoutMs)
    ).toBeNull();
  });

  it('supports the symmetric short resolution below the prior 4h swing low', async () => {
    vi.stubEnv('V3_TRANSITION_RESOLUTION_ENABLED', 'true');
    const breakoutMs = Date.UTC(2026, 8, 4, 12, 0, 0);
    const obs = observation(breakoutMs);
    obs.side = 'short';
    obs.breakout_metrics = { support: 90, volumeRatio: 1.9, breakoutStrengthPct: 0.8 };
    obs.all_blocks = ['structure'];
    obs.gates = {
      structure: { status: 'block' },
      htf_trend: { status: 'pass' },
      side_align: {
        status: 'pass',
        observed: { htf_tf: '1h', regime: 'trend', trend_direction: 'bearish' },
      },
    };

    const created = await registerTransitionRetestCandidate(
      obs,
      candle(breakoutMs, 89),
      undefined,
      breakoutMs
    );
    expect(created).toMatchObject({
      candidate_kind: 'transition_resolution',
      side: 'short',
      mode: 'shadow',
      resolution_evidence: { prior_swing_price: 95, latest_swing_price: 90 },
    });
  });

  it('records an early structure flip as shadow-only and revalidates the retest', async () => {
    vi.stubEnv('V3_TRANSITION_RETEST_MODE', 'live');
    const breakoutMs = Date.UTC(2026, 8, 4, 12, 0, 0);
    const obs = observation(breakoutMs);
    obs.structure_bias = 'bear';
    obs.structure_detail = {
      bias: 'bear',
      swingHighs: [110, 100],
      swingLows: [95, 90],
      reason: 'LH+LL',
    };
    obs.breakout_metrics = { resistance: 100, volumeRatio: 2, breakoutStrengthPct: 1 };

    const getScan = (tf: string) => (tf === '1h' || tf === '15m' ? htfScan() : undefined);
    const created = await registerTransitionRetestCandidate(
      obs,
      candle(breakoutMs, 111),
      htfScan().signalResult,
      breakoutMs,
      getScan
    );
    expect(created).toMatchObject({
      candidate_kind: 'early_structure_flip',
      mode: 'shadow',
      boundary_price: 110,
    });

    const retestMs = breakoutMs + 15 * 60_000;
    await processTransitionRetestScan({
      symbol: 'BTC',
      timeframe: '15m',
      candles: [{ timestamp: retestMs, open: 110, high: 111, low: 109.95, close: 110.5, volume: 1 }],
      getScan,
      nowMs: retestMs,
    });
    expect(getTransitionRetestStateForTests().positions).toHaveLength(1);
    expect(getTransitionRetestStateForTests().opportunities).toHaveLength(0);
    expect(repo.recordEvent).toHaveBeenCalledWith(
      'transition_retest_confirmed',
      expect.objectContaining({ candidate_kind: 'early_structure_flip', rr: 3 })
    );
  });

  it.each([{ retestClose: 91.5, requireBos: true }, { retestClose: 109, requireBos: true },
    { retestClose: 91.5, requireBos: false }])('validates range retest $retestClose with micro BOS requirement $requireBos', async ({ retestClose, requireBos }) => {
    vi.stubEnv('V3_ADAPTIVE_SETUP_MODE', 'live');
    vi.stubEnv('V3_RANGE_SWEEP_RETEST_REQUIRE_BOS', String(requireBos));
    vi.stubEnv('V3_RANGE_SWEEP_REQUIRE_TARGET_ROOM', 'true');
    vi.stubEnv('V3_RANGE_SWEEP_LONG_5M_ONLY', 'true');
    vi.stubEnv('V3_RANGE_SWEEP_RR', '1.5');
    const breakoutMs = Date.now() - 5 * 60_000;
    const obs = observation(breakoutMs);
    obs.timeframe = '5m';
    obs.playbook = 'liquidity_sweep_reclaim';
    obs.structure_bias = 'transition';
    obs.breakout_metrics = null;
    const signal = { ...rangeScan().signalResult, pass: false };
    // The core breakout bypass must not overwrite adaptive's observed range regime.
    const getScan = (tf: string) => tf === '1h' ? { ...rangeScan(), signalResult: { ...rangeScan().signalResult, gateRegime: 'trend' as const } } : undefined;
    const created = await registerTransitionRetestCandidate(
      obs,
      [{ timestamp: breakoutMs, open: 91, high: 92.2, low: 90.5, close: 92, volume: 2 }],
      signal,
      breakoutMs + 5 * 60_000,
      getScan
    );
    expect(created).toMatchObject({
      candidate_kind: 'range_sweep_reclaim',
      side: 'long',
      timeframe: '5m',
      mode: 'live',
      boundary_price: 91,
    });

    const retestMs = breakoutMs + 5 * 60_000;
    await processTransitionRetestScan({
      symbol: 'BTC',
      timeframe: '5m',
      candles: [
        { timestamp: retestMs - 15 * 60_000, open: 90, high: 90.5, low: 89, close: 90, volume: 1 },
        { timestamp: retestMs - 10 * 60_000, open: 90, high: 91.4, low: 90, close: 91, volume: 1 },
        { timestamp: retestMs - 5 * 60_000, open: 90.5, high: 90.8, low: 89.8, close: 90.2, volume: 1 },
        { timestamp: retestMs, open: 90.8, high: retestClose + .3, low: 90.9, close: retestClose, volume: 1 },
      ].slice(requireBos ? 0 : -1),
      getScan,
      nowMs: retestMs + 5 * 60_000,
    });
    if (retestClose === 109) {
      expect(getTransitionRetestStateForTests().opportunities).toHaveLength(0);
      expect(getTransitionRetestStateForTests().candidates).toHaveLength(1);
      expect(repo.recordEvent).toHaveBeenCalledWith('transition_retest_target_blocked',
        expect.objectContaining({ reason: 'target exceeds observed range or bounds unavailable' }));
      return;
    }
    expect(getTransitionRetestStateForTests().opportunities).toHaveLength(1);
    expect(peekTransitionRetestOpportunity('BTC')).toMatchObject({
      candidate_kind: 'range_sweep_reclaim',
      rr: 1.5,
    });
  });

  it('waits for a later retest, requires HTF BOS, then records a shadow TP', async () => {
    const breakoutMs = Date.UTC(2026, 7, 30, 0, 0, 0);
    const detectedAt = Date.now();
    const gradeAObservation = observation(breakoutMs);
    gradeAObservation.grade = 'A';
    gradeAObservation.confidence = 0.85;
    const created = await registerTransitionRetestCandidate(
      gradeAObservation,
      candle(breakoutMs, 101),
      undefined,
      detectedAt
    );
    expect(created).not.toBeNull();

    const getScan = (tf: string) => (tf === '1h' ? htfScan() : undefined);
    await processTransitionRetestScan({
      symbol: 'BTC', timeframe: '15m', candles: candle(breakoutMs, 101), getScan, nowMs: detectedAt,
    });
    expect(getTransitionRetestStateForTests().positions).toHaveLength(0);

    const retestMs = breakoutMs + 15 * 60_000;
    await processTransitionRetestScan({
      symbol: 'BTC', timeframe: '15m', candles: candle(retestMs, 100.5, 99.95, 100.7), getScan,
      nowMs: detectedAt + 15 * 60_000,
    });
    expect(getTransitionRetestStateForTests().positions).toHaveLength(1);
    expect(repo.recordEvent).toHaveBeenCalledWith(
      'transition_retest_confirmed',
      expect.objectContaining({ candidate_key: created!.candidate_key, rr: 3 })
    );

    await processTransitionRetestScan({
      symbol: 'BTC', timeframe: '15m', candles: candle(retestMs + 15 * 60_000, 102, 100, 104), getScan,
      nowMs: detectedAt + 30 * 60_000,
    });
    expect(getTransitionRetestStateForTests().positions).toHaveLength(0);
    expect(repo.recordEvent).toHaveBeenCalledWith(
      'transition_retest_shadow_outcome',
      expect.objectContaining({ close_reason: 'take_profit', realized_r_gross: 3 })
    );
  });

  it('ignores directional structure with additional blockers and non-breakout observations', async () => {
    const obs = observation(Date.now());
    obs.structure_bias = 'bull';
    expect(await registerTransitionRetestCandidate(obs, candle(Date.now(), 101))).toBeNull();
    obs.structure_bias = 'transition';
    obs.playbook = 'liquidity_sweep_reclaim';
    expect(await registerTransitionRetestCandidate(obs, candle(Date.now(), 101))).toBeNull();
  });

  it('does not let an earlier shadow wave suppress a later live trend candidate', async () => {
    vi.stubEnv('V3_TRANSITION_RETEST_MODE', 'live');
    vi.stubEnv('V3_TREND_BREAKOUT_RETEST_ENABLED', 'true');
    const waveStart = Date.UTC(2026, 8, 5, 17, 0, 0);

    const shadowObservation = observation(waveStart);
    shadowObservation.timeframe = '5m';
    const shadow = await registerTransitionRetestCandidate(
      shadowObservation,
      candle(waveStart, 101),
      undefined,
      waveStart
    );
    expect(shadow).toMatchObject({ candidate_kind: 'transition', mode: 'shadow' });

    const liveObservation = observation(waveStart + 15 * 60_000);
    liveObservation.structure_bias = 'bull';
    liveObservation.first_block = 'pullback_proxy';
    liveObservation.all_blocks = ['pullback_proxy'];
    liveObservation.gates = {
      structure: { status: 'pass' },
      htf_trend: { status: 'pass' },
      side_align: { status: 'pass' },
      pullback_proxy: { status: 'block', reason: 'entry extended above SMA' },
      account_eligibility: { status: 'pass' },
    };
    const signalResult = {
      ...htfScan().signalResult,
      pass: true,
      shouldCallGroq: true,
      reason: 'breakout pass',
      setupResult: {
        ...htfScan().signalResult.setupResult,
        playbookKey: 'breakout_volume',
        grade: 'A' as const,
        confidence: 0.85,
      },
    };

    const live = await registerTransitionRetestCandidate(
      liveObservation,
      candle(waveStart + 15 * 60_000, 101),
      signalResult,
      waveStart + 15 * 60_000,
      (tf) => (tf === '1h' || tf === '15m' ? htfScan() : undefined)
    );

    expect(live).toMatchObject({
      candidate_kind: 'trend',
      timeframe: '15m',
      mode: 'live',
      shadow_wave_bypassed: true,
    });
    expect(getTransitionRetestStateForTests().candidates).toHaveLength(2);
  });

  it('re-arms an aligned trend breakout when pullback is the sole blocker', async () => {
    vi.stubEnv('V3_TRANSITION_RETEST_MODE', 'live');
    vi.stubEnv('V3_TREND_BREAKOUT_RETEST_ENABLED', 'true');
    const breakoutMs = Date.UTC(2026, 7, 30, 0, 0, 0);
    const obs = observation(breakoutMs);
    obs.timeframe = '5m';
    obs.structure_bias = 'bull';
    obs.first_block = 'pullback_proxy';
    obs.all_blocks = ['pullback_proxy'];
    obs.gates = {
      structure: { status: 'pass' },
      htf_trend: { status: 'pass' },
      side_align: { status: 'pass' },
      pullback_proxy: { status: 'block', reason: 'entry extended above SMA' },
      account_eligibility: { status: 'pass' },
    };
    const signalResult = {
      ...htfScan().signalResult,
      pass: true,
      shouldCallGroq: true,
      reason: 'breakout pass',
      setupResult: {
        ...htfScan().signalResult.setupResult,
        playbookKey: 'breakout_volume',
        grade: 'A' as const,
        confidence: 0.85,
      },
    };

    const created = await registerTransitionRetestCandidate(
      obs,
      candle(breakoutMs, 101),
      signalResult,
      breakoutMs,
      (tf) => (tf === '1h' || tf === '15m' ? htfScan() : undefined)
    );
    expect(created).toMatchObject({ candidate_kind: 'trend', mode: 'live' });

    const retestMs = breakoutMs + 15 * 60_000;
    await processTransitionRetestScan({
      symbol: 'BTC',
      timeframe: '5m',
      candles: candle(retestMs, 100.5, 99.95, 100.7),
      getScan: (tf) => (tf === '1h' ? htfScan() : undefined),
      nowMs: retestMs,
    });

    const ready = peekTransitionRetestOpportunity('BTC', retestMs);
    expect(ready).toMatchObject({ candidate_key: created!.candidate_key, side: 'long' });
    expect(getTransitionRetestStateForTests().opportunities).toHaveLength(1);
    expect(await claimTransitionRetestOpportunity(created!.candidate_key)).not.toBeNull();
    expect(peekTransitionRetestOpportunity('BTC')).toBeNull();
    expect(repo.recordEvent).toHaveBeenCalledWith(
      'transition_retest_live_claimed',
      expect.objectContaining({ candidate_key: created!.candidate_key })
    );
  });

  it('never promotes transition structure to live dispatch', async () => {
    vi.stubEnv('V3_TRANSITION_RETEST_MODE', 'live');
    const breakoutMs = Date.UTC(2026, 7, 30, 0, 0, 0);
    const obs = observation(breakoutMs);
    const created = await registerTransitionRetestCandidate(
      obs,
      candle(breakoutMs, 101),
      htfScan().signalResult,
      breakoutMs
    );
    expect(created).toMatchObject({ candidate_kind: 'transition', mode: 'shadow' });

    const retestMs = breakoutMs + 15 * 60_000;
    await processTransitionRetestScan({
      symbol: 'BTC',
      timeframe: '15m',
      candles: candle(retestMs, 100.5, 99.95, 100.7),
      getScan: (tf) => (tf === '1h' ? htfScan() : undefined),
      nowMs: retestMs,
    });
    expect(peekTransitionRetestOpportunity('BTC')).toBeNull();
    expect(getTransitionRetestStateForTests().positions).toHaveLength(1);
  });

  it('deduplicates the same breakout wave across timeframes', async () => {
    const breakoutMs = Date.UTC(2026, 7, 30, 0, 55, 0);
    const first = observation(breakoutMs);
    const second = observation(breakoutMs + 10 * 60_000);
    second.timeframe = '5m';
    second.observation_key = `BTC:5m:kim_nghia:${second.bar_key}`;

    expect(
      await registerTransitionRetestCandidate(first, candle(breakoutMs, 101))
    ).not.toBeNull();
    expect(
      await registerTransitionRetestCandidate(
        second,
        candle(breakoutMs + 10 * 60_000, 101)
      )
    ).toBeNull();
    expect(getTransitionRetestStateForTests().candidates).toHaveLength(1);
  });

  it('fails closed and restores an opportunity when durable claim recording fails', async () => {
    vi.stubEnv('V3_TRANSITION_RETEST_MODE', 'live');
    const breakoutMs = Date.now();
    const obs = observation(breakoutMs);
    obs.structure_bias = 'bull';
    obs.first_block = 'pullback_proxy';
    obs.all_blocks = ['pullback_proxy'];
    obs.gates = { pullback_proxy: { status: 'block' } };
    const signalResult = {
      ...htfScan().signalResult,
      pass: true,
      shouldCallGroq: true,
      setupResult: {
        ...htfScan().signalResult.setupResult,
        playbookKey: 'breakout_volume',
        grade: 'A' as const,
        confidence: 0.85,
      },
    };
    const created = await registerTransitionRetestCandidate(
      obs,
      candle(breakoutMs, 101),
      signalResult,
      breakoutMs
    );
    const retestMs = breakoutMs + 15 * 60_000;
    await processTransitionRetestScan({
      symbol: 'BTC',
      timeframe: '15m',
      candles: candle(retestMs, 100.5, 99.95, 100.7),
      getScan: (tf) => (tf === '1h' ? htfScan() : undefined),
      nowMs: retestMs,
    });
    repo.recordEvent.mockResolvedValueOnce(null);

    expect(await claimTransitionRetestOpportunity(created!.candidate_key)).toBeNull();
    expect(peekTransitionRetestOpportunity('BTC', retestMs)).not.toBeNull();
  });
});
