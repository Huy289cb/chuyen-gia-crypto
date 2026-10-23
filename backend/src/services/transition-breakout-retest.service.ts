import { getCandles } from './candle.service';
import { observeEntryFeasibility } from '../utils/entry-feasibility-observation';
import { compareRetestFeasibility } from '../utils/retest-feasibility';
/**
 * Stateful breakout -> retest state machine.
 *
 * Transition setups are always shadow-only. Directional trend setups can be
 * re-armed for LLM dispatch only when pullback was the sole remaining blocker.
 * The normal dispatch/execution pipeline still revalidates every live gate.
 */

import type { UnifiedCandle } from './candle.service';
import type { EntryGateFunnelObservation, FunnelScanSnapshot } from './entry-gate-funnel.service';
import {
  isTransitionRetestGradeEligible,
  getTransitionRetestInvalidationPct,
  getTransitionRetestMaxHoldHours,
  getTransitionRetestMode,
  getTransitionResolutionTtlMinutes,
  getTransitionRetestRequireHtfTf,
  getTransitionRetestTolerancePct,
  getTransitionRetestTtlMinutes,
  isTransitionRetestBosRequired,
  isTransitionRetestLlmEnabled,
  isTransitionRetestShadowEnabled,
  isTransitionResolutionEnabled,
  isTrendBreakoutRetestEnabled,
} from '../config/transition-retest-policy';
import { evaluateStructureSidePermission } from '../config/v3-structure-bias-policy';
import { evaluateScanFreshness } from '../utils/scan-freshness';
import { computePolicyCompliantStopAndTarget } from '../utils/trade-levels';
import { hasRangeTargetRoom } from '../utils/range-target-room';
import { getRiskPolicy } from '../config/risk-policy';
import { getMethodConfig } from '../config/methods';
import {
  getSilentPipelineEvents,
  hasSilentPipelineEventKey,
  recordSilentPipelineEvent,
} from '../repositories/testnet.repository';
import type { SignalGateOutput } from './signal-gate.service';
import {
  getAdaptiveFeePctPerSide,
  getAdaptiveMicroBosStrength,
  getAdaptiveSetupRr,
  getAdaptiveSetupTtlMinutes,
  getRangeSweepEdgeFraction,
  isAdaptiveSetupLiveEnabled,
  isAdaptiveSetupShadowEnabled,
  isAlignedMicroBosRequire1hAlign,
  isAlignedMicroBosEnabled,
  isEarlyStructureFlipEnabled,
  isRangeSweepReclaimEnabled,
  isRangeSweepLong5mOnly,
  isRangeSweepRetestBosRequired,
  isRangeSweepTargetRoomRequired,
  type AdaptiveSetupKind,
} from '../config/adaptive-setup-policy';
import {
  detectAdaptiveSetup,
  hasMicroBos,
  retestCandleRejects,
  type AdaptiveHtfState,
} from '../utils/adaptive-setup';

export type TransitionRetestSide = 'long' | 'short';

export interface TransitionRetestCandidate {
  initial_feasibility?: ReturnType<typeof observeEntryFeasibility>;
  observation_key?: string;
  schema_version: 1;
  candidate_key: string;
  wave_key: string;
  symbol: string;
  timeframe: string;
  side: TransitionRetestSide;
  grade: string;
  boundary_price: number;
  breakout_bar_key: string;
  breakout_bar_open_ms: number;
  breakout_close: number;
  volume_ratio: number | null;
  breakout_strength_pct: number | null;
  detected_at: string;
  expires_at: string;
  mode: string;
  candidate_kind: 'transition' | 'transition_resolution' | 'trend' | AdaptiveSetupKind;
  /** True when a dispatchable setup was admitted despite an earlier shadow wave. */
  shadow_wave_bypassed?: boolean;
  adaptive_evidence?: Record<string, unknown>;
  resolution_evidence?: {
    prior_swing_price: number;
    latest_swing_price: number;
    htf_timeframe: string;
    htf_direction: 'bullish' | 'bearish';
  };
  /** Original breakout evidence. Live dispatch reuses it with the retest candles. */
  signal_result?: SignalGateOutput;
}

interface ShadowRetestPosition extends TransitionRetestCandidate {
  confirmed_bar_open_ms: number;
  confirmed_at: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  rr: number;
}

export interface TransitionRetestOpportunity extends ShadowRetestPosition {
  signal_result: SignalGateOutput;
}

export interface TransitionRetestScanInput {
  symbol: string;
  timeframe: string;
  candles: UnifiedCandle[];
  getScan: (timeframe: string) => FunnelScanSnapshot | undefined;
  nowMs?: number;
}

const EVENT_TYPES = [
  'transition_retest_candidate',
  'transition_retest_confirmed',
  'transition_retest_expired',
  'transition_retest_invalidated',
  'transition_retest_htf_blocked',
  'transition_retest_live_claimed',
  'transition_retest_live_dispatch',
  'transition_retest_shadow_outcome',
] as const;

const candidates = new Map<string, TransitionRetestCandidate>();
const shadowPositions = new Map<string, ShadowRetestPosition>();
const liveOpportunities = new Map<string, TransitionRetestOpportunity>();
const htfBlockedBars = new Set<string>();
const seenWaves = new Set<string>();
// Shadow experiments must not consume the dedupe identity of a setup that can
// actually be dispatched later in the same market impulse.
const seenDispatchWaves = new Set<string>();
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function slotKey(candidate: Pick<TransitionRetestCandidate, 'symbol' | 'timeframe' | 'side'>): string {
  return `${candidate.symbol}:${candidate.timeframe}:${candidate.side}`;
}

function candidateCanDispatchLive(
  candidate: Pick<TransitionRetestCandidate, 'candidate_kind' | 'side' | 'timeframe'>
): boolean {
  return (
    candidate.candidate_kind === 'trend' ||
    (candidate.candidate_kind === 'range_sweep_reclaim' &&
      candidate.side === 'long' &&
      candidate.timeframe === '5m')
  );
}

function candidateLlmEnabled(candidate: TransitionRetestCandidate): boolean {
  return candidate.candidate_kind === 'range_sweep_reclaim'
    ? isAdaptiveSetupLiveEnabled()
    : isTransitionRetestLlmEnabled();
}

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const since = new Date(Date.now() - (getTransitionRetestMaxHoldHours() + 24) * 3_600_000);
    const events = await getSilentPipelineEvents([...EVENT_TYPES], since);
    for (const event of events) {
      const data = event.event_data as unknown as TransitionRetestCandidate & ShadowRetestPosition;
      if (!data.candidate_key) continue;
      if (event.event_type === 'transition_retest_candidate') {
        if (data.wave_key) seenWaves.add(data.wave_key);
        if (
          data.wave_key &&
          (data.mode === 'live' || data.mode === 'shadow_llm') &&
          candidateCanDispatchLive(data)
        ) {
          seenDispatchWaves.add(data.wave_key);
        }
        candidates.set(slotKey(data), data);
      } else if (event.event_type === 'transition_retest_confirmed') {
        candidates.delete(slotKey(data));
        shadowPositions.set(data.candidate_key, data);
        if (
          (data.mode === 'live' || data.mode === 'shadow_llm') &&
          candidateCanDispatchLive(data) &&
          data.signal_result
        ) {
          liveOpportunities.set(data.candidate_key, data as TransitionRetestOpportunity);
        }
      } else if (
        event.event_type === 'transition_retest_expired' ||
        event.event_type === 'transition_retest_invalidated'
      ) {
        candidates.delete(slotKey(data));
      } else if (event.event_type === 'transition_retest_shadow_outcome') {
        shadowPositions.delete(data.candidate_key);
      } else if (
        event.event_type === 'transition_retest_live_claimed' ||
        event.event_type === 'transition_retest_live_dispatch'
      ) {
        liveOpportunities.delete(data.candidate_key);
      }
    }
    hydrated = true;
  })().finally(() => {
    hydrationPromise = null;
  });
  return hydrationPromise;
}

function candidateBoundary(observation: EntryGateFunnelObservation): number | null {
  const key = observation.side === 'long' ? 'resistance' : 'support';
  return finite(observation.breakout_metrics?.[key]);
}

function candidateMetric(
  observation: EntryGateFunnelObservation,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = finite(observation.breakout_metrics?.[key]);
    if (value != null) return value;
  }
  return null;
}

function adaptiveKindEnabled(kind: AdaptiveSetupKind): boolean {
  if (kind === 'early_structure_flip') return isEarlyStructureFlipEnabled();
  if (kind === 'aligned_micro_bos') return isAlignedMicroBosEnabled();
  return isRangeSweepReclaimEnabled();
}

function selectedPlaybookMetrics(
  signalResult: SignalGateOutput | undefined,
  playbook: string
): Record<string, unknown> | null {
  // The selected setup uses the policy key `liquidity_sweep_reclaim`, while
  // the underlying analyzer evidence is intentionally named
  // `liquidity_sweep`. Normalize that one public/analyzer naming boundary so
  // live detection receives the same metrics as the historical replay.
  const evidencePlaybook =
    playbook === 'liquidity_sweep_reclaim' ? 'liquidity_sweep' : playbook;
  const evidence = signalResult?.setupResult.evidence.playbooks.find(
    (row) => row.playbook === evidencePlaybook
  );
  return evidence?.metrics ? { ...evidence.metrics } : null;
}

function adaptiveHtfState(scan: FunnelScanSnapshot | undefined): AdaptiveHtfState {
  const freshness = evaluateScanFreshness(scan?.timestamp, { label: 'Adaptive HTF' });
  if (!scan || !freshness.pass) {
    return { fresh: false, regime: 'unknown', trendDirection: null, candles: [] };
  }
  const setup = scan.signalResult.setupResult;
  // Adaptive replay uses the observed regime, before the breakout execution bypass.
  const regime = setup.regime;
  return {
    fresh: true,
    regime,
    trendDirection: setup.evidence.regime.trendDirection ?? null,
    candles: scan.candles,
  };
}

function adaptiveDetection(
  observation: EntryGateFunnelObservation,
  candles: UnifiedCandle[],
  signalResult: SignalGateOutput | undefined,
  getScan: ((timeframe: string) => FunnelScanSnapshot | undefined) | undefined
) {
  if (
    !isAdaptiveSetupShadowEnabled() ||
    !getScan ||
    (observation.side !== 'long' && observation.side !== 'short')
  ) {
    return null;
  }
  const last = candles.at(-1);
  if (!last) return null;
  const detected = detectAdaptiveSetup({
    side: observation.side,
    timeframe: observation.timeframe,
    playbook: observation.playbook,
    grade: observation.grade,
    close: last.close,
    boundary: candidateBoundary(observation),
    structureBias: observation.structure_bias,
    structureDetail: observation.structure_detail,
    htf1h: adaptiveHtfState(getScan('1h')),
    htf15m: adaptiveHtfState(getScan('15m')),
    selectedMetrics: selectedPlaybookMetrics(signalResult, observation.playbook),
    rangeEdgeFraction: getRangeSweepEdgeFraction(),
    microBosStrength: getAdaptiveMicroBosStrength(),
    microRequire1hAlign: isAlignedMicroBosRequire1hAlign(),
    rangeLong5mOnly: isRangeSweepLong5mOnly(),
  });
  return detected && adaptiveKindEnabled(detected.kind) ? detected : null;
}

function transitionResolutionEvidence(
  observation: EntryGateFunnelObservation,
  breakoutClose: number
): TransitionRetestCandidate['resolution_evidence'] | null {
  if (!isTransitionResolutionEnabled() || observation.structure_bias !== 'transition') {
    return null;
  }

  // A resolution candidate may still be blocked by the hard 4h transition
  // gate, the pullback proxy, or the account circuit. Market-quality gates
  // (regime, funding, direction and HTF alignment) must already pass.
  const allowedBlocks = new Set(['structure', 'pullback_proxy', 'account_eligibility']);
  if (
    observation.gates.structure?.status !== 'block' ||
    !observation.all_blocks.every((name) => allowedBlocks.has(name)) ||
    observation.gates.htf_trend?.status !== 'pass' ||
    observation.gates.side_align?.status !== 'pass' ||
    (observation.all_blocks.includes('pullback_proxy') &&
      observation.gates.pullback_proxy?.status !== 'block')
  ) {
    return null;
  }

  const expected = observation.side === 'long' ? 'bullish' : 'bearish';
  const sideAlignObserved = observation.gates.side_align.observed;
  if (
    sideAlignObserved?.regime !== 'trend' ||
    sideAlignObserved?.trend_direction !== expected
  ) {
    return null;
  }

  const swings =
    observation.side === 'long'
      ? observation.structure_detail?.swingHighs
      : observation.structure_detail?.swingLows;
  if (!swings || swings.length < 2) return null;
  const [prior, latest] = swings.slice(-2);
  const structureExtended = observation.side === 'long' ? latest > prior : latest < prior;
  const priceResolved = observation.side === 'long' ? breakoutClose > prior : breakoutClose < prior;
  if (!structureExtended || !priceResolved) return null;

  return {
    prior_swing_price: prior,
    latest_swing_price: latest,
    htf_timeframe: getTransitionRetestRequireHtfTf(),
    htf_direction: expected,
  };
}

export async function registerTransitionRetestCandidate(
  observation: EntryGateFunnelObservation,
  candles: UnifiedCandle[],
  signalResult?: SignalGateOutput,
  nowMs = Date.now(),
  getScan?: (timeframe: string) => FunnelScanSnapshot | undefined
): Promise<TransitionRetestCandidate | null> {
  if (!isTransitionRetestShadowEnabled()) return null;
  await hydrate();

  const mode = getTransitionRetestMode();
  if (
    (observation.side !== 'long' && observation.side !== 'short')
  ) {
    return null;
  }

  const adaptive = adaptiveDetection(observation, candles, signalResult, getScan);
  const legacyEligible =
    observation.playbook === 'breakout_volume' &&
    isTransitionRetestGradeEligible(observation.grade);
  if (!legacyEligible && !adaptive) return null;

  const isTransition = observation.structure_bias === 'transition';
  const isAlignedTrend =
    (observation.structure_bias === 'bull' && observation.side === 'long') ||
    (observation.structure_bias === 'bear' && observation.side === 'short');
  const pullbackIsOnlyBlock =
    observation.gates.pullback_proxy?.status === 'block' &&
    observation.all_blocks.length === 1 &&
    observation.all_blocks[0] === 'pullback_proxy';
  const isTrendCandidate =
    signalResult?.pass === true && isTrendBreakoutRetestEnabled() && isAlignedTrend && pullbackIsOnlyBlock;
  // Preserve the already-deployed trend-retest live path. The adaptive
  // micro-BOS shadow must only add observations, never demote a previously
  // eligible live trend opportunity.
  const selectedAdaptive = isTrendCandidate ? null : adaptive;

  const boundary = selectedAdaptive?.boundary ?? candidateBoundary(observation);
  const last = candles.at(-1);
  if (!(boundary && last && Number.isFinite(last.close))) return null;

  const resolutionEvidence = transitionResolutionEvidence(observation, last.close);
  const isTransitionResolution = isTransition && resolutionEvidence != null;
  // Once the stricter transition-resolution experiment is enabled, stop
  // collecting generic transition impulses that have not resolved structure.
  const isLegacyTransition = isTransition && !isTransitionResolutionEnabled();

  if (!isLegacyTransition && !isTransitionResolution && !isTrendCandidate && !selectedAdaptive) {
    return null;
  }
  if (isTrendCandidate && isTransitionRetestLlmEnabled() && !signalResult) return null;

  const candidateKind: TransitionRetestCandidate['candidate_kind'] = selectedAdaptive
    ? selectedAdaptive.kind
    : isTrendCandidate
      ? 'trend'
      : isTransitionResolution
        ? 'transition_resolution'
        : 'transition';
  const candidateMode = selectedAdaptive
    ? isAdaptiveSetupLiveEnabled() &&
      candidateKind === 'range_sweep_reclaim' &&
      observation.side === 'long' &&
      observation.timeframe === '5m'
      ? 'live'
      : 'shadow'
    : isTrendCandidate
      ? mode
      : 'shadow';
  if (candidateMode === 'live' && !signalResult) return null;

  const key = `${observation.symbol}:${observation.timeframe}:${observation.side}:${observation.bar_key}`;
  // Adjacent 5m/15m/1h observations from one impulse are one opportunity, not
  // separate trades. Hourly wave identity prevents cross-timeframe over-entry.
  const waveKey = `${observation.symbol}:${observation.side}:${Math.floor(
    last.timestamp / 3_600_000
  )}`;
  const slot = `${observation.symbol}:${observation.timeframe}:${observation.side}`;
  const canDispatch =
    (candidateMode === 'live' || candidateMode === 'shadow_llm') &&
    candidateCanDispatchLive({
      candidate_kind: candidateKind,
      side: observation.side,
      timeframe: observation.timeframe,
    });
  const overlapsActiveWave = [...candidates.values(), ...shadowPositions.values()].some(
    (row) =>
      row.symbol === observation.symbol &&
      row.side === observation.side &&
      Math.abs(row.breakout_bar_open_ms - last.timestamp) <= 60 * 60_000 &&
      Math.abs(row.boundary_price - boundary) / boundary <= 0.005 &&
      // Keep collecting the shadow outcome, but never let shadow-only state
      // suppress a later live-quality setup from the same wave.
      (!canDispatch ||
        ((row.mode === 'live' || row.mode === 'shadow_llm') &&
          candidateCanDispatchLive(row)))
  );
  if (
    candidates.has(slot) ||
    shadowPositions.has(key) ||
    (canDispatch ? seenDispatchWaves.has(waveKey) : seenWaves.has(waveKey)) ||
    overlapsActiveWave
  ) {
    return null;
  }
  if (await hasSilentPipelineEventKey('transition_retest_candidate', 'candidate_key', key)) {
    return null;
  }
  const shadowWaveBypassed =
    canDispatch && seenWaves.has(waveKey) && !seenDispatchWaves.has(waveKey);

  const candidate: TransitionRetestCandidate = {
    initial_feasibility: observation.feasibility,
    observation_key: observation.observation_key,
    schema_version: 1,
    candidate_key: key,
    wave_key: waveKey,
    symbol: observation.symbol,
    timeframe: observation.timeframe,
    side: observation.side,
    grade: observation.grade,
    boundary_price: boundary,
    breakout_bar_key: observation.bar_key,
    breakout_bar_open_ms: last.timestamp,
    breakout_close: last.close,
    volume_ratio: candidateMetric(observation, 'volumeRatio', 'volume_ratio'),
    breakout_strength_pct: candidateMetric(
      observation,
      'breakoutStrengthPct',
      'breakout_strength_pct'
    ),
    detected_at: new Date(nowMs).toISOString(),
    expires_at: new Date(
      nowMs +
        (selectedAdaptive
          ? getAdaptiveSetupTtlMinutes(selectedAdaptive.kind)
          : isTransitionResolution
            ? getTransitionResolutionTtlMinutes()
            : getTransitionRetestTtlMinutes()) *
          60_000
    ).toISOString(),
    // Transition remains shadow-only. Only fully aligned trend candidates can
    // reach shadow_llm/live.
    mode: candidateMode,
    candidate_kind: candidateKind,
    shadow_wave_bypassed: shadowWaveBypassed || undefined,
    adaptive_evidence: selectedAdaptive?.evidence,
    resolution_evidence: resolutionEvidence ?? undefined,
    signal_result: candidateMode === 'live' || isTrendCandidate ? signalResult : undefined,
  };
  seenWaves.add(waveKey);
  if (canDispatch) seenDispatchWaves.add(waveKey);
  candidates.set(slot, candidate);
  await recordSilentPipelineEvent(
    'transition_retest_candidate',
    candidate as unknown as Record<string, unknown>
  );
  console.log(
    `[TransitionRetest] ${candidate.candidate_kind} candidate ${candidate.candidate_key} ` +
      `boundary=${candidate.boundary_price} mode=${candidate.mode}`
  );
  return candidate;
}

function htfConfirmation(
  candidate: TransitionRetestCandidate,
  input: TransitionRetestScanInput
): { pass: boolean; reason: string } {
  const latest = input.candles.at(-1);
  if (
    (candidate.candidate_kind === 'early_structure_flip' ||
      candidate.candidate_kind === 'aligned_micro_bos' ||
      candidate.candidate_kind === 'range_sweep_reclaim') &&
    (!latest || !retestCandleRejects(candidate.side, latest))
  ) {
    return { pass: false, reason: 'retest candle has no directional rejection' };
  }

  if (candidate.candidate_kind === 'aligned_micro_bos') {
    const scan1h = input.getScan('1h');
    const scan15m = input.getScan('15m');
    const state1h = adaptiveHtfState(scan1h);
    const state15m = adaptiveHtfState(scan15m);
    const expected = candidate.side === 'long' ? 'bullish' : 'bearish';
    const opposed = candidate.side === 'long' ? 'bearish' : 'bullish';
    const htfPass = isAlignedMicroBosRequire1hAlign()
      ? state1h.fresh && state1h.regime === 'trend' && state1h.trendDirection === expected
      : state1h.fresh && state1h.trendDirection !== opposed;
    if (!htfPass) {
      return { pass: false, reason: `1h unavailable or opposed ${candidate.side}` };
    }
    const bos = state15m.fresh
      ? hasMicroBos(candidate.side, state15m.candles, getAdaptiveMicroBosStrength())
      : { pass: false, level: null };
    return {
      pass: bos.pass,
      reason: bos.pass ? `15m micro BOS ${bos.level}` : '15m micro BOS unavailable/not confirmed',
    };
  }

  if (candidate.candidate_kind === 'range_sweep_reclaim') {
    const state1h = adaptiveHtfState(input.getScan('1h'));
    if (!state1h.fresh || state1h.regime !== 'range') {
      return { pass: false, reason: `1h no longer a fresh range (${state1h.regime})` };
    }
    if (!isRangeSweepRetestBosRequired()) {
      return { pass: true, reason: 'fresh 1h range + directional retest' };
    }
    const bos = hasMicroBos(candidate.side, input.candles, getAdaptiveMicroBosStrength());
    return {
      pass: bos.pass,
      reason: bos.pass ? `local reclaim BOS ${bos.level}` : 'local reclaim BOS not confirmed',
    };
  }

  const htf = getTransitionRetestRequireHtfTf();
  const scan = input.getScan(htf);
  const fresh = evaluateScanFreshness(scan?.timestamp, { label: `Retest HTF ${htf}` });
  if (!scan || !fresh.pass) return { pass: false, reason: fresh.reason ?? `${htf} unavailable` };

  const setup = scan.signalResult.setupResult;
  const expected = candidate.side === 'long' ? 'bullish' : 'bearish';
  if (setup.regime !== 'trend' || setup.evidence.regime.trendDirection !== expected) {
    return {
      pass: false,
      reason: `${htf} ${setup.regime}/${setup.evidence.regime.trendDirection ?? 'null'} not aligned ${candidate.side}`,
    };
  }
  if (candidate.candidate_kind === 'early_structure_flip') {
    return { pass: true, reason: `${htf} trend confirms early structure flip` };
  }

  const structure = evaluateStructureSidePermission({
    side: candidate.side,
    candles: scan.candles,
    enabled: true,
    longRequireBos: isTransitionRetestBosRequired(),
    shortRequireBos: isTransitionRetestBosRequired(),
  });
  return {
    pass: structure.pass,
    reason: structure.reason ?? `${htf} structure ${structure.bias}`,
  };
}

async function closeShadowPosition(
  position: ShadowRetestPosition,
  candle: UnifiedCandle,
  reason: 'stop_loss' | 'take_profit' | 'max_hold',
  closePrice: number
): Promise<void> {
  const risk = Math.abs(position.entry_price - position.stop_loss);
  const signedMove =
    position.side === 'long'
      ? closePrice - position.entry_price
      : position.entry_price - closePrice;
  const realizedR = risk > 0 ? signedMove / risk : 0;
  const feeR = risk > 0
    ? (position.entry_price * getAdaptiveFeePctPerSide() * 2) / risk
    : 0;
  const realizedNetR = realizedR - feeR;
  await recordSilentPipelineEvent('transition_retest_shadow_outcome', {
    ...position,
    close_bar_open_ms: candle.timestamp,
    close_price: closePrice,
    close_reason: reason,
    realized_r_gross: realizedR,
    estimated_fee_r: feeR,
    realized_r_net: realizedNetR,
    closed_at: new Date().toISOString(),
  });
  shadowPositions.delete(position.candidate_key);
  console.log(
    `[TransitionRetest] shadow ${reason} ${position.candidate_key} R=${realizedR.toFixed(2)}`
  );
}

async function evaluateShadowPositions(input: TransitionRetestScanInput, nowMs: number): Promise<void> {
  for (const position of [...shadowPositions.values()]) {
    if (position.symbol !== input.symbol || position.timeframe !== input.timeframe) continue;
    const candle = input.candles.at(-1);
    if (!candle || candle.timestamp <= position.confirmed_bar_open_ms) continue;
    const slHit =
      position.side === 'long' ? candle.low <= position.stop_loss : candle.high >= position.stop_loss;
    const tpHit =
      position.side === 'long' ? candle.high >= position.take_profit : candle.low <= position.take_profit;
    if (slHit) {
      await closeShadowPosition(position, candle, 'stop_loss', position.stop_loss);
      continue;
    }
    if (tpHit) {
      await closeShadowPosition(position, candle, 'take_profit', position.take_profit);
      continue;
    }
    const heldMs = nowMs - Date.parse(position.confirmed_at);
    if (heldMs >= getTransitionRetestMaxHoldHours() * 3_600_000) {
      await closeShadowPosition(position, candle, 'max_hold', candle.close);
    }
  }
}

export async function processTransitionRetestScan(input: TransitionRetestScanInput): Promise<void> {
  if (!isTransitionRetestShadowEnabled()) return;
  await hydrate();
  const nowMs = input.nowMs ?? Date.now();
  await evaluateShadowPositions(input, nowMs);

  const candle = input.candles.at(-1);
  if (!candle) return;
  for (const [slot, candidate] of [...candidates.entries()]) {
    if (candidate.symbol !== input.symbol || candidate.timeframe !== input.timeframe) continue;
    if (candle.timestamp <= candidate.breakout_bar_open_ms) continue;

    if (nowMs >= Date.parse(candidate.expires_at)) {
      await recordSilentPipelineEvent('transition_retest_expired', {
        ...candidate,
        expired_at: new Date(nowMs).toISOString(),
      });
      candidates.delete(slot);
      continue;
    }

    const tolerance = getTransitionRetestTolerancePct() / 100;
    const invalidation = getTransitionRetestInvalidationPct() / 100;
    const boundary = candidate.boundary_price;
    const invalidated =
      candidate.side === 'long'
        ? candle.close < boundary * (1 - invalidation)
        : candle.close > boundary * (1 + invalidation);
    if (invalidated) {
      await recordSilentPipelineEvent('transition_retest_invalidated', {
        ...candidate,
        invalidated_bar_open_ms: candle.timestamp,
        invalidated_close: candle.close,
        invalidated_at: new Date(nowMs).toISOString(),
      });
      candidates.delete(slot);
      continue;
    }

    const touches =
      candidate.side === 'long'
        ? candle.low <= boundary * (1 + tolerance)
        : candle.high >= boundary * (1 - tolerance);
    const holds = candidate.side === 'long' ? candle.close >= boundary : candle.close <= boundary;
    if (!touches || !holds) continue;

    const confirmation = htfConfirmation(candidate, input);
    if (!confirmation.pass) {
      const blockedKey = `${candidate.candidate_key}:${candle.timestamp}`;
      if (!htfBlockedBars.has(blockedKey)) {
        htfBlockedBars.add(blockedKey);
        await recordSilentPipelineEvent('transition_retest_htf_blocked', {
          ...candidate,
          retest_bar_open_ms: candle.timestamp,
          retest_close: candle.close,
          blocked_at: new Date(nowMs).toISOString(),
          reason: confirmation.reason,
        });
      }
      continue;
    }
    const risk = getRiskPolicy();
    const isAdaptive =
      candidate.candidate_kind === 'early_structure_flip' ||
      candidate.candidate_kind === 'aligned_micro_bos' ||
      candidate.candidate_kind === 'range_sweep_reclaim';
    const envRr = Number(process.env.MIN_RR_RATIO);
    const rr = isAdaptive
      ? getAdaptiveSetupRr(candidate.candidate_kind as AdaptiveSetupKind)
      : Number.isFinite(envRr) && envRr > 0
        ? envRr
        : getMethodConfig('kim_nghia').autoEntry.minRRRatio;
    const levels = computePolicyCompliantStopAndTarget({
      action: candidate.side === 'long' ? 'buy' : 'sell',
      entry: candle.close,
      minSlPct: risk.minSlDistancePercent,
      minRr: rr,
    });
    if (!levels) continue;

    if (candidate.candidate_kind === 'range_sweep_reclaim' && isRangeSweepTargetRoomRequired() &&
        !hasRangeTargetRoom({ side: candidate.side, entry: candle.close, target: levels.takeProfit,
          rangeLow: Number(candidate.adaptive_evidence?.range_low),
          rangeHigh: Number(candidate.adaptive_evidence?.range_high) })) {
      const blockedKey = `target-room:${candidate.candidate_key}:${candle.timestamp}`;
      if (!htfBlockedBars.has(blockedKey)) {
        htfBlockedBars.add(blockedKey);
        await recordSilentPipelineEvent('transition_retest_target_blocked', {
          ...candidate, retest_bar_open_ms: candle.timestamp, retest_close: candle.close,
          take_profit: levels.takeProfit, reason: 'target exceeds observed range or bounds unavailable',
        });
      }
      continue;
    }

    const position: ShadowRetestPosition = {
      ...candidate,
      confirmed_bar_open_ms: candle.timestamp,
      confirmed_at: new Date(nowMs).toISOString(),
      entry_price: candle.close,
      stop_loss: levels.stopLoss,
      take_profit: levels.takeProfit,
      rr,
    };
    // Paired observations reuse the immutable candidate; additional H4 reads never grant entry permission.
    try {
      const fourHour = await getCandles({symbol: input.symbol, timeframe: '4h', limit: 121});
      const measurement = observeEntryFeasibility({ asOf: nowMs, timeframe: input.timeframe,
        candles: input.candles, structureCandles: fourHour.candles, side: candidate.side,
        entry: candle.close, minSlFraction: getRiskPolicy().minSlDistancePercent, minRr: rr });
      await recordSilentPipelineEvent('retest_feasibility_pair', { candidate_key: candidate.candidate_key,
        wave_key: candidate.wave_key, observation_key: candidate.observation_key,
        comparison: compareRetestFeasibility(candidate.initial_feasibility, measurement) });
    } catch {
      await recordSilentPipelineEvent('retest_feasibility_pair', { candidate_key: candidate.candidate_key,
        comparison: { paired: false, reason: 'missing_data' } });
    }
    await recordSilentPipelineEvent(
      'transition_retest_confirmed',
      position as unknown as Record<string, unknown>
    );
    candidates.delete(slot);
    shadowPositions.set(candidate.candidate_key, position);
    if (
      candidateCanDispatchLive(candidate) &&
      (candidate.mode === 'live' || candidate.mode === 'shadow_llm') &&
      candidate.signal_result &&
      candidateLlmEnabled(candidate)
    ) {
      liveOpportunities.set(
        candidate.candidate_key,
        position as TransitionRetestOpportunity
      );
    }
    console.log(
      `[TransitionRetest] shadow confirmed ${candidate.candidate_key} entry=${position.entry_price} ` +
        `SL=${position.stop_loss} TP=${position.take_profit}`
    );
  }
}

/** Oldest confirmed directional retest waiting for an LLM decision. */
export function peekTransitionRetestOpportunity(
  symbol: string,
  nowMs = Date.now()
): TransitionRetestOpportunity | null {
  const normalized = symbol.toUpperCase();
  for (const [key, row] of liveOpportunities.entries()) {
    if (Date.parse(row.expires_at) <= nowMs) liveOpportunities.delete(key);
  }
  const eligible = [...liveOpportunities.values()]
    .filter(
      (row) =>
        row.symbol.toUpperCase() === normalized &&
        Date.parse(row.expires_at) > nowMs
    )
    .sort((a, b) => Date.parse(a.confirmed_at) - Date.parse(b.confirmed_at));
  return eligible[0] ?? null;
}

/** Claim before dispatch so a worker restart cannot submit the same retest twice. */
export async function claimTransitionRetestOpportunity(
  candidateKey: string
): Promise<TransitionRetestOpportunity | null> {
  const opportunity = liveOpportunities.get(candidateKey);
  if (!opportunity) return null;
  liveOpportunities.delete(candidateKey);
  const eventId = await recordSilentPipelineEvent('transition_retest_live_claimed', {
    ...opportunity,
    claimed_at: new Date().toISOString(),
  });
  if (eventId == null) {
    // Fail closed: without a durable claim, a restart could dispatch this same
    // opportunity twice. Restore it for a later healthy cycle.
    liveOpportunities.set(candidateKey, opportunity);
    return null;
  }
  return opportunity;
}

export async function recordTransitionRetestDispatch(input: {
  opportunity: TransitionRetestOpportunity;
  decision: 'trade' | 'no_trade';
  reason: string;
  executionAttempted: boolean;
  executionSuccess?: boolean;
  executionReason?: string;
  decisionRecordId?: number;
}): Promise<void> {
  await recordSilentPipelineEvent('transition_retest_live_dispatch', {
    candidate_key: input.opportunity.candidate_key,
    symbol: input.opportunity.symbol,
    timeframe: input.opportunity.timeframe,
    side: input.opportunity.side,
    grade: input.opportunity.grade,
    mode: input.opportunity.mode,
    candidate_kind: input.opportunity.candidate_kind,
    decision: input.decision,
    reason: input.reason,
    execution_attempted: input.executionAttempted,
    execution_success: input.executionSuccess,
    execution_reason: input.executionReason,
    decision_id: input.decisionRecordId,
    dispatched_at: new Date().toISOString(),
  });
}

export function resetTransitionRetestStateForTests(): void {
  candidates.clear();
  shadowPositions.clear();
  liveOpportunities.clear();
  htfBlockedBars.clear();
  seenWaves.clear();
  seenDispatchWaves.clear();
  hydrated = false;
  hydrationPromise = null;
}

export function getTransitionRetestStateForTests(): {
  candidates: TransitionRetestCandidate[];
  positions: ShadowRetestPosition[];
  opportunities: TransitionRetestOpportunity[];
} {
  return {
    candidates: [...candidates.values()],
    positions: [...shadowPositions.values()],
    opportunities: [...liveOpportunities.values()],
  };
}
