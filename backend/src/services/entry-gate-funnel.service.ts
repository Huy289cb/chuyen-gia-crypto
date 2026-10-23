import { observeStructuralRoot } from '../utils/structural-root';
import { observeEntryFeasibility } from '../utils/entry-feasibility-observation';
import { getRiskPolicy } from '../config/risk-policy';
import { getMethodConfig } from '../config/methods';
/**
 * Non-short-circuit observability for deterministic entry gates.
 * This service never calls an LLM or places/cancels an exchange order.
 */

import type { SignalGateOutput } from './signal-gate.service';
import { getCandles, type UnifiedCandle } from './candle.service';
import {
  evaluate5mEntryGuards,
  evaluateHtfSideAlign,
  evaluateHtfTrendRequirement,
  evaluateSetupGradePlaybookFilter,
  evaluateTrendPullbackEntry,
  getV3BreakoutPullbackMaxAbovePct,
  getV3HtfSideAlignTf,
  getV3HtfTrendAlt,
  getV3PullbackMaxAbovePct,
  getV3PullbackMaxBelowPct,
  getV3PullbackSmaPeriod,
  getV3PullbackTf,
  getV3RequireHtfTrend,
  isRangeEntryBlocked,
  isV3RequirePullback,
  isV3RequireHtfSideAlign,
  resolveGateRegimeFromSignal,
} from '../config/v3-entry-policy';
import {
  evaluateStructureSidePermission,
  getV3StructureBiasCandleLimit,
  getV3StructureBiasTf,
  isV3StructureBiasEnabled,
  type StructureBias,
  type StructureBiasResult,
} from '../config/v3-structure-bias-policy';
import {
  evaluateFundingVeto,
  fetchCachedFundingRate,
  isFundingVetoEnabled,
} from '../config/funding-veto';
import { getPremiumIndex } from './binance/market';
import { inferSetupTradeSide, type TradeSide } from '../utils/setup-trade-side';
import { identifyAnchoredSetup, type SetupIdentity } from '../utils/setup-identity';
import { closedCandlesOnly, getClosedCandleFinalizationGraceMs } from '../utils/closed-candles';
import { generateCandleBarKey } from '../utils/candle-hash';
import { evaluateScanFreshness } from '../utils/scan-freshness';
import { canRunLlmDispatchForSymbol } from './v3-entry-eligibility.service';
import {
  hasSilentPipelineEventKey,
  recordSilentPipelineEvent,
} from '../repositories/testnet.repository';

export type FunnelGateStatus = 'pass' | 'block' | 'unavailable' | 'not_applicable';

/** Aggregatable reject reason codes for day/% cohort measurement (read-only). */
export type FunnelRejectCohort =
  | 'rr'
  | 'target_room'
  | 'pullback'
  | 'structure'
  | 'grade_playbook'
  | 'regime'
  | 'htf'
  | 'side_align'
  | 'funding'
  | 'eligibility'
  | 'signal'
  | 'direction'
  | 'entry_5m'
  | 'other'
  | 'pass';

export interface FunnelGateResult {
  status: FunnelGateStatus;
  reason?: string;
  observed?: Record<string, unknown>;
}

const GATE_TO_COHORT: Record<string, FunnelRejectCohort> = {
  signal_gate: 'signal',
  direction: 'direction',
  regime: 'regime',
  grade_playbook: 'grade_playbook',
  structure: 'structure',
  htf_trend: 'htf',
  side_align: 'side_align',
  entry_5m_guard: 'entry_5m',
  funding: 'funding',
  pullback_proxy: 'pullback',
  account_eligibility: 'eligibility',
};

const FEASIBILITY_TO_COHORT: Record<string, FunnelRejectCohort> = {
  rr: 'rr',
  target_room: 'target_room',
  missing_target_bound: 'target_room',
  stop_floor: 'rr',
  invalid_levels: 'rr',
  geometry_feasible: 'pass',
  no_setup: 'signal',
  missing_data: 'other',
};

/**
 * Map funnel gate blocks + diagnostic feasibility into stable reject cohorts.
 * Feasibility is diagnostic-only (does not change live risk caps).
 */
export function classifyFunnelRejectCohorts(input: {
  all_blocks: string[];
  first_block: string | null;
  feasibilityStatus?: string | null;
}): {
  primary: FunnelRejectCohort;
  cohorts: FunnelRejectCohort[];
  feasibility_cohort: FunnelRejectCohort | null;
} {
  const cohorts: FunnelRejectCohort[] = [];
  for (const gate of input.all_blocks) {
    const c = GATE_TO_COHORT[gate] ?? 'other';
    if (!cohorts.includes(c)) cohorts.push(c);
  }
  const feasRaw = input.feasibilityStatus ?? null;
  const feasibility_cohort =
    feasRaw != null ? (FEASIBILITY_TO_COHORT[feasRaw] ?? (feasRaw === 'geometry_feasible' ? 'pass' : 'other')) : null;
  // Surface RR/target_room even when gate proxies passed — estimates ops swallowed by RR3.
  if (
    feasibility_cohort &&
    feasibility_cohort !== 'pass' &&
    feasibility_cohort !== 'other' &&
    !cohorts.includes(feasibility_cohort)
  ) {
    cohorts.push(feasibility_cohort);
  }
  if (cohorts.length === 0) {
    return { primary: 'pass', cohorts: ['pass'], feasibility_cohort };
  }
  const firstMapped = input.first_block
    ? (GATE_TO_COHORT[input.first_block] ?? 'other')
    : cohorts[0];
  return { primary: firstMapped, cohorts, feasibility_cohort };
}

export interface FunnelScanSnapshot {
  timestamp: Date;
  signalResult: SignalGateOutput;
  candles: UnifiedCandle[];
}

export interface EntryGateFunnelObservation {
  schema_version: 1;
  measurement_version?: 2;
  classification?: 'missing_data' | 'no_setup' | 'blocked' | 'proxy_pass';
  pre_ai_proxy_pass?: boolean;
  post_ai_proxy_blocks?: string[];
  feasibility?: ReturnType<typeof observeEntryFeasibility>;
  structural_root_candidate?: ReturnType<typeof observeStructuralRoot>;
  structural_root_child_price?: number;
  setup_identity?: SetupIdentity;
  observation_key: string;
  bar_key: string;
  symbol: string;
  timeframe: string;
  evaluated_at: string;
  grade: string;
  confidence: number;
  playbook: string;
  side: TradeSide | null;
  local_regime: string;
  gate_regime: string;
  first_block: string | null;
  all_blocks: string[];
  /** Primary reject cohort for %/day rollups (rr, target_room, pullback, structure, …). */
  reject_cohort: FunnelRejectCohort;
  /** All mapped cohorts including diagnostic feasibility (RR/target_room). */
  reject_cohorts: FunnelRejectCohort[];
  feasibility_cohort: FunnelRejectCohort | null;
  day_key: string;
  would_pass_pre_llm: boolean;
  structure_bias: StructureBias | null;
  structure_detail: StructureBiasResult | null;
  breakout_metrics: Record<string, unknown> | null;
  gates: Record<string, FunnelGateResult>;
}

export interface EntryGateFunnelInput {
  symbol: string;
  timeframe: string;
  candles: UnifiedCandle[];
  signalResult: SignalGateOutput;
  getScan: (timeframe: string) => FunnelScanSnapshot | undefined;
  methodId?: string;
}

const recordedKeys = new Set<string>();

function gate(pass: boolean, reason?: string, observed?: Record<string, unknown>): FunnelGateResult {
  return { status: pass ? 'pass' : 'block', reason, observed };
}

function unavailable(reason: string): FunnelGateResult {
  return { status: 'unavailable', reason };
}

function notApplicable(reason?: string): FunnelGateResult {
  return { status: 'not_applicable', reason };
}

function readFreshScan(
  input: EntryGateFunnelInput,
  timeframe: string
): { fresh: boolean; regime: string; trendDirection: 'bullish' | 'bearish' | null; reason?: string } {
  const scan = input.getScan(timeframe);
  const freshness = evaluateScanFreshness(scan?.timestamp, { label: `HTF ${timeframe}` });
  if (!scan || !freshness.pass) {
    return {
      fresh: false,
      regime: 'unknown',
      trendDirection: null,
      reason: freshness.reason ?? `HTF ${timeframe} unavailable`,
    };
  }
  return {
    fresh: true,
    regime: resolveGateRegimeFromSignal(scan.signalResult),
    trendDirection: scan.signalResult.setupResult.evidence.regime.trendDirection ?? null,
  };
}

function breakoutMetrics(signalResult: SignalGateOutput): Record<string, unknown> | null {
  const evidence = signalResult.setupResult.evidence.playbooks.find(
    (row) => row.playbook === 'breakout_volume'
  );
  return evidence?.metrics ? { ...evidence.metrics } : null;
}

export async function evaluateEntryGateFunnel(
  input: EntryGateFunnelInput
): Promise<EntryGateFunnelObservation> {
  const asOf = Date.now();
  let structureCandles: UnifiedCandle[] = [];
  const setup = input.signalResult.setupResult;
  const side = inferSetupTradeSide(setup, input.timeframe, input.candles);
  const gateRegime = resolveGateRegimeFromSignal(input.signalResult);
  const gates: Record<string, FunnelGateResult> = {};

  gates.signal_gate = gate(input.signalResult.pass, input.signalResult.reason, {
    grade: setup.grade,
    confidence: setup.confidence,
    local_regime: setup.regime,
    gate_regime: gateRegime,
  });
  gates.direction = side
    ? gate(true, `playbook side ${side}`)
    : unavailable('playbook direction unavailable');
  gates.regime = gate(!isRangeEntryBlocked(gateRegime), `gate regime ${gateRegime}`);

  const gradeCheck = evaluateSetupGradePlaybookFilter({
    grade: setup.grade,
    confidence: setup.confidence,
    playbookKey: setup.playbookKey,
  });
  gates.grade_playbook = gate(gradeCheck.pass, gradeCheck.reason);

  let structureBias: StructureBias | null = null;
  let structureDetail: StructureBiasResult | null = null;
  if (!side) {
    gates.structure = notApplicable('structure cannot evaluate without side');
  } else if (!isV3StructureBiasEnabled()) {
    gates.structure = notApplicable('structure disabled');
  } else {
    try {
      const tf = getV3StructureBiasTf();
      const limit = getV3StructureBiasCandleLimit();
      const { candles: fetched } = await getCandles({
        symbol: input.symbol,
        timeframe: tf,
        limit: limit + 1,
      });
      const closed = closedCandlesOnly(fetched, tf, asOf).slice(-limit);
      structureCandles = closed;
      const check = evaluateStructureSidePermission({ side, candles: closed });
      structureBias = check.bias;
      structureDetail = check.detail ?? null;
      gates.structure = gate(check.pass, check.reason, {
        bias: check.bias,
        swing_highs: check.detail?.swingHighs ?? [],
        swing_lows: check.detail?.swingLows ?? [],
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      gates.structure = unavailable(`structure unavailable: ${reason}`);
    }
  }

  const primaryTf = getV3RequireHtfTrend();
  if (!primaryTf) {
    gates.htf_trend = notApplicable('HTF trend requirement disabled');
  } else {
    const primary = readFreshScan(input, primaryTf);
    const altTf = getV3HtfTrendAlt();
    const alt = altTf ? readFreshScan(input, altTf) : null;
    if (!primary.fresh) {
      gates.htf_trend = unavailable(primary.reason ?? `${primaryTf} unavailable`);
    } else {
      const check = evaluateHtfTrendRequirement({
        entryTimeframe: input.timeframe,
        primaryTf,
        primaryRegime: primary.regime,
        altTf,
        altRegime: alt?.fresh ? alt.regime : 'unknown',
      });
      gates.htf_trend = gate(check.pass, check.reason, {
        primary_tf: primaryTf,
        primary_regime: primary.regime,
        alt_tf: altTf,
        alt_regime: alt?.regime,
      });
    }
  }

  if (!side) {
    gates.side_align = notApplicable('side align cannot evaluate without side');
  } else if (!isV3RequireHtfSideAlign()) {
    gates.side_align = notApplicable('HTF side alignment disabled');
  } else {
    const alignTf = getV3HtfSideAlignTf();
    const align = readFreshScan(input, alignTf);
    if (!align.fresh) {
      gates.side_align = unavailable(align.reason ?? `${alignTf} unavailable`);
    } else {
      const check = evaluateHtfSideAlign({
        side,
        htfTf: alignTf,
        htf: align,
        structureBias: structureBias ?? undefined,
      });
      gates.side_align = gate(check.pass, check.reason, {
        htf_tf: alignTf,
        regime: align.regime,
        trend_direction: align.trendDirection,
      });
    }
  }

  if (input.timeframe !== '5m') {
    gates.entry_5m_guard = notApplicable('entry timeframe is not 5m');
  } else if (!side) {
    gates.entry_5m_guard = notApplicable('5m guard cannot evaluate without side');
  } else {
    const tf1h = readFreshScan(input, '1h');
    const tf15m = readFreshScan(input, '15m');
    const check = evaluate5mEntryGuards({
      entryTimeframe: input.timeframe,
      side,
      tf1h,
      tf15m,
    });
    gates.entry_5m_guard = gate(check.pass, check.reason);
  }

  if (!side || !isFundingVetoEnabled()) {
    gates.funding = notApplicable(!side ? 'funding requires side' : 'funding veto disabled');
  } else {
    const pair = `${input.symbol.toUpperCase().replace(/USDT$/i, '')}USDT`;
    const rate = await fetchCachedFundingRate(pair, getPremiumIndex);
    const check = evaluateFundingVeto({ side, fundingRate: rate });
    gates.funding = gate(check.pass, check.reason, { funding_rate: rate });
  }

  if (!side || !isV3RequirePullback()) {
    gates.pullback_proxy = notApplicable(!side ? 'pullback requires side' : 'pullback disabled');
  } else {
    try {
      const tf = getV3PullbackTf();
      const period = getV3PullbackSmaPeriod();
      const { candles: fetched } = await getCandles({
        symbol: input.symbol,
        timeframe: tf,
        limit: period + 6,
      });
      const closes = closedCandlesOnly(fetched, tf, asOf).map((row) => row.close);
      const entry = closedCandlesOnly(input.candles, input.timeframe, asOf).at(-1)?.close;
      if (!(entry && Number.isFinite(entry))) {
        gates.pullback_proxy = unavailable('candidate close unavailable');
      } else {
        const maxAbove =
          setup.playbookKey === 'breakout_volume'
            ? getV3BreakoutPullbackMaxAbovePct()
            : getV3PullbackMaxAbovePct();
        const check = evaluateTrendPullbackEntry({
          side,
          entry,
          closes,
          smaPeriod: period,
          maxAbovePct: maxAbove,
          maxBelowPct: getV3PullbackMaxBelowPct(),
          tfLabel: `SMA${period}@${tf}`,
        });
        gates.pullback_proxy = gate(check.pass, check.reason, {
          proxy_entry: true,
          entry,
          sma: check.sma,
          dist_pct: check.distPct,
        });
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      gates.pullback_proxy = unavailable(`pullback unavailable: ${reason}`);
    }
  }

  try {
    const eligibility = await canRunLlmDispatchForSymbol(
      input.symbol,
      input.methodId ?? 'kim_nghia'
    );
    gates.account_eligibility = gate(eligibility.allowed, eligibility.reason);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    gates.account_eligibility = unavailable(`eligibility unavailable: ${reason}`);
  }

  const allBlocks = Object.entries(gates)
    .filter(([, result]) => result.status === 'block' || result.status === 'unavailable')
    .map(([name]) => name);

  const feasibility = observeEntryFeasibility({
    asOf,
    timeframe: input.timeframe,
    candles: input.candles,
    structureCandles,
    structureTimeframe: getV3StructureBiasTf(),
    side,
    minSlFraction: getRiskPolicy().minSlDistancePercent,
    minRr: getMethodConfig(input.methodId ?? 'kim_nghia').autoEntry.minRRRatio,
  });
  const firstBlock = allBlocks[0] ?? null;
  const cohortInfo = classifyFunnelRejectCohorts({
    all_blocks: allBlocks,
    first_block: firstBlock,
    feasibilityStatus: feasibility.status,
  });
  const evaluatedAt = new Date().toISOString();
  // ICT day key (UTC+7) for daily reject % rollups — measurement only.
  const dayKey = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

  const barKey = generateCandleBarKey(input.candles);
  return {
    schema_version: 1,
    measurement_version: 2,
    structural_root_candidate: getV3StructureBiasTf()==='4h' ? observeStructuralRoot(structureCandles,input.symbol,asOf,getClosedCandleFinalizationGraceMs()) : null,
    structural_root_child_price: closedCandlesOnly(input.candles,input.timeframe,asOf).at(-1)?.close,
    setup_identity: identifyAnchoredSetup({
      symbol: input.symbol, timeframe: input.timeframe, playbook: setup.playbookKey ?? 'unknown',
      side, detected: setup.evidence.playbooks.find(p => p.playbook === setup.playbookKey)?.detected ?? false,
      metrics: setup.evidence.playbooks.find(p => p.playbook === setup.playbookKey)?.metrics ?? {},
      asOf, graceMs: getClosedCandleFinalizationGraceMs(),
    }),
    classification: !side && !input.signalResult.pass && (setup.grade === 'D' || !setup.playbookKey || setup.playbookKey === 'unknown') ? 'no_setup' :
      Object.values(gates).some(g => g.status === 'unavailable') ? 'missing_data' : allBlocks.length ? 'blocked' : 'proxy_pass',
    // Legacy dispatch checks signal/regime and structure before AI; remaining proxies run after AI.
    pre_ai_proxy_pass: ['signal_gate', 'regime', 'direction', 'structure'].every(k =>
      gates[k].status === 'pass' || gates[k].status === 'not_applicable'),
    post_ai_proxy_blocks: allBlocks.filter(k => !['signal_gate', 'regime', 'direction', 'structure'].includes(k)),
    feasibility,
    observation_key: `${input.symbol.toUpperCase()}:${input.timeframe}:${input.methodId ?? 'kim_nghia'}:${barKey}`,
    bar_key: barKey,
    symbol: input.symbol.toUpperCase(),
    timeframe: input.timeframe,
    evaluated_at: evaluatedAt,
    grade: setup.grade,
    confidence: setup.confidence,
    playbook: setup.playbookKey ?? 'unknown',
    side,
    local_regime: setup.regime,
    gate_regime: gateRegime,
    first_block: firstBlock,
    all_blocks: allBlocks,
    reject_cohort: cohortInfo.primary,
    reject_cohorts: cohortInfo.cohorts,
    feasibility_cohort: cohortInfo.feasibility_cohort,
    day_key: dayKey,
    would_pass_pre_llm: allBlocks.length === 0,
    structure_bias: structureBias,
    structure_detail: structureDetail,
    breakout_metrics: breakoutMetrics(input.signalResult),
    gates,
  };
}

export async function recordEntryGateFunnel(
  input: EntryGateFunnelInput
): Promise<EntryGateFunnelObservation | null> {
  const barKey = generateCandleBarKey(input.candles);
  const dedupKey = `${input.symbol}:${input.timeframe}:${input.methodId ?? 'kim_nghia'}:${barKey}`;
  if (recordedKeys.has(dedupKey)) return null;

  if (await hasSilentPipelineEventKey('gate_funnel_shadow', 'observation_key', dedupKey)) {
    return null;
  }

  const observation = await evaluateEntryGateFunnel(input);
  const eventId = await recordSilentPipelineEvent(
    'gate_funnel_shadow',
    observation as unknown as Record<string, unknown>
  );
  if (eventId === null) throw new Error('Gate funnel persistence failed');
  recordedKeys.add(dedupKey);
  if (recordedKeys.size > 4096) recordedKeys.delete(recordedKeys.values().next().value!);
  return observation;
}

export function clearEntryGateFunnelDedupForTests(): void {
  recordedKeys.clear();
}
