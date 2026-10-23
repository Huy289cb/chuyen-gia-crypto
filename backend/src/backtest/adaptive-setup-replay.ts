import { hasRangeTargetRoom } from '../utils/range-target-room';
import { ReplayAccount, type ReplayFunding } from './replay-account';
import { analyzeSetupGate } from '../analyzers/setup-gate.analyzer';
import { computeRegimeEvidence } from '../analyzers/market-regime.analyzer';
import {
  getAdaptiveFeePctPerSide,
  getAdaptiveMicroBosStrength,
  getAdaptiveSetupRr,
  getAdaptiveSetupTtlMinutes,
  getRangeSweepEdgeFraction,
  isRangeSweepRetestBosRequired,
  isAlignedMicroBosRequire1hAlign,
  isRangeSweepLong5mOnly,
  type AdaptiveSetupKind,
} from '../config/adaptive-setup-policy';
import {
  getV3StructureBiasCandleLimit,
  getV3StructureBiasStrength,
} from '../config/v3-structure-bias-policy';
import { getRiskPolicy } from '../config/risk-policy';
import { getPostCloseSameSideCooldownMinutes } from '../config/pending-order-policy';
import { inferSetupTradeSide } from '../utils/setup-trade-side';
import { classifyStructureBias } from '../utils/structure-bias';
import {
  detectAdaptiveSetup,
  hasMicroBos,
  retestCandleRejects,
  type AdaptiveHtfState,
  type AdaptiveSide,
} from '../utils/adaptive-setup';
import { candleCloseTimestamp, closedCandlesUpTo } from './candle-loader';
import type { BacktestCandle } from './types';

export interface AdaptiveReplayCandidate {
  kind: AdaptiveSetupKind;
  side: AdaptiveSide;
  timeframe: '5m' | '15m';
  grade: string;
  boundary: number;
  detectedAt: number;
  breakoutBarOpenMs: number;
  expiresAt: number;
  context: Record<string, unknown>;
}

export interface AdaptiveReplayOutcome {
  kind: AdaptiveSetupKind;
  side: AdaptiveSide;
  timeframe: string;
  grade: string;
  detectedAt: number;
  confirmedAt: number;
  closedAt: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  closePrice: number;
  closeReason: 'stop_loss' | 'take_profit' | 'max_hold' | 'end_of_data';
  grossR: number;
  netR: number;
  barsHeld: number;
  context: Record<string, unknown>;
  financial?: ReturnType<ReplayAccount['close']>;
}

interface ReplayPosition extends AdaptiveReplayCandidate {
  confirmedAt: number;
  entryBarOpenMs: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rr: number;
  barsHeld: number;
}

export interface AdaptiveReplayResult {
  period: { start: string; end: string };
  config: {
    minSlPct: number;
    feePctPerSide: number;
    maxHoldHours: number;
    rangeEdgeFraction: number;
    microBosStrength: number;
    rangeRequireMicroBos: boolean;
    microRequire1hAlign: boolean;
    rangeLong5mOnly: boolean;
  };
  byKind: Record<AdaptiveSetupKind, AdaptiveReplayStats>;
  outcomes: AdaptiveReplayOutcome[];
  account?: { initialWallet: number; endingWallet: number; blocks: Record<string, number> };
}

export interface AdaptiveReplayStats {
  candidates: number;
  confirmed: number;
  expired: number;
  invalidated: number;
  outcomes: number;
  wins: number;
  losses: number;
  sumNetR: number;
  avgNetR: number;
  profitFactorNet: number | null;
}

const KINDS: AdaptiveSetupKind[] = [
  'early_structure_flip',
  'aligned_micro_bos',
  'range_sweep_reclaim',
];

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function state(candles: BacktestCandle[], timeframe: string): AdaptiveHtfState {
  if (candles.length < 50) {
    return { fresh: false, regime: 'unknown', trendDirection: null, candles };
  }
  const evidence = computeRegimeEvidence(candles, { timeframe });
  return {
    fresh: true,
    regime: evidence.regime,
    trendDirection: evidence.trendDirection,
    candles,
  };
}

function candidatePassesRetest(input: {
  candidate: AdaptiveReplayCandidate;
  candle: BacktestCandle;
  localCandles: BacktestCandle[];
  htf1h: AdaptiveHtfState;
  htf15m: AdaptiveHtfState;
  microBosStrength: number;
  rangeRequireMicroBos: boolean;
}): boolean {
  if (!retestCandleRejects(input.candidate.side, input.candle)) return false;
  const expected = input.candidate.side === 'long' ? 'bullish' : 'bearish';
  const opposed = input.candidate.side === 'long' ? 'bearish' : 'bullish';
  if (input.candidate.kind === 'early_structure_flip') {
    return (
      input.htf1h.fresh &&
      input.htf1h.regime === 'trend' &&
      input.htf1h.trendDirection === expected
    );
  }
  if (input.candidate.kind === 'aligned_micro_bos') {
    return (
      input.htf1h.fresh &&
      input.htf1h.trendDirection !== opposed &&
      input.htf15m.fresh &&
      hasMicroBos(
        input.candidate.side,
        input.htf15m.candles,
        input.microBosStrength
      ).pass
    );
  }
  return (
    input.htf1h.fresh &&
    input.htf1h.regime === 'range' &&
    (!input.rangeRequireMicroBos ||
      hasMicroBos(
        input.candidate.side,
        input.localCandles,
        input.microBosStrength
      ).pass)
  );
}

function emptyStats(): AdaptiveReplayStats {
  return {
    candidates: 0,
    confirmed: 0,
    expired: 0,
    invalidated: 0,
    outcomes: 0,
    wins: 0,
    losses: 0,
    sumNetR: 0,
    avgNetR: 0,
    profitFactorNet: 0,
  };
}

function finishStats(
  stats: Record<AdaptiveSetupKind, AdaptiveReplayStats>,
  outcomes: AdaptiveReplayOutcome[]
): void {
  for (const kind of KINDS) {
    const values = outcomes.filter((row) => row.kind === kind).map((row) => row.netR);
    const wins = values.filter((value) => value > 0);
    const losses = values.filter((value) => value < 0);
    const profit = wins.reduce((sum, value) => sum + value, 0);
    const loss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
    Object.assign(stats[kind], {
      outcomes: values.length,
      wins: wins.length,
      losses: losses.length,
      sumNetR: values.reduce((sum, value) => sum + value, 0),
      avgNetR: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
      profitFactorNet: loss > 0 ? profit / loss : profit > 0 ? null : 0,
    });
  }
}

function closePosition(
  position: ReplayPosition,
  bar: BacktestCandle,
  closePrice: number,
  closeReason: AdaptiveReplayOutcome['closeReason'],
  feePctPerSide: number
): AdaptiveReplayOutcome {
  const risk = Math.abs(position.entryPrice - position.stopLoss);
  const move = position.side === 'long'
    ? closePrice - position.entryPrice
    : position.entryPrice - closePrice;
  const grossR = risk > 0 ? move / risk : 0;
  const feeR = risk > 0 ? (position.entryPrice * feePctPerSide * 2) / risk : 0;
  return {
    kind: position.kind,
    side: position.side,
    timeframe: position.timeframe,
    grade: position.grade,
    detectedAt: position.detectedAt,
    confirmedAt: position.confirmedAt,
    closedAt: candleCloseTimestamp(bar, '5m'),
    entryPrice: position.entryPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    closePrice,
    closeReason,
    grossR,
    netR: grossR - feeR,
    barsHeld: position.barsHeld,
    context: position.context,
  };
}

/**
 * Closed-candle, stateful replay of candidate -> later retest -> fixed SL/TP.
 * Each setup family is evaluated as an independent strategy so one family
 * cannot hide another merely by occupying the single live position slot.
 */
export async function runAdaptiveSetupReplay(input: {
  byTf: Record<string, BacktestCandle[]>;
  start: Date;
  end: Date;
  symbol?: string;
  minSlPct?: number;
  feePctPerSide?: number;
  maxHoldHours?: number;
  rrByKind?: Partial<Record<AdaptiveSetupKind, number>>;
  ttlByKind?: Partial<Record<AdaptiveSetupKind, number>>;
  rangeEdgeFraction?: number;
  microBosStrength?: number;
  rangeRequireMicroBos?: boolean;
  microRequire1hAlign?: boolean;
  rangeLong5mOnly?: boolean;
  candidateFilter?: (candidate: AdaptiveReplayCandidate) => boolean;
  /** Research inventory without position occupancy suppressing candidate detection. */
  collectOnly?: boolean;
  onConfirmed?: (candidate: AdaptiveReplayCandidate, time: number, entry: number) => void;
  executionWalletUsd?: number;
  slippageFraction?: number;
  fundingHistory?: ReplayFunding[];
  requireRangeTargetRoom?: boolean;
  /** Sensitivity to live durable claims: executor risk/budget rejection consumes the candidate. */
  consumeExecutionRejectedRetests?: boolean;
  /** Include the executor's any-side post-close cooldown in financial admission. */
  modelPostCloseCooldown?: boolean;
  quantityFilters?: import('./replay-account').ReplayAccountOptions['quantityFilters'];
  admissionReserve?: import('./replay-account').ReplayAccountOptions['admissionReserve'];
}): Promise<AdaptiveReplayResult> {
  if (input.collectOnly && input.executionWalletUsd != null) throw new Error('Inventory cannot use an execution account');
  const symbol = input.symbol ?? 'BTC';
  const policy = getRiskPolicy();
  if (input.executionWalletUsd != null && symbol !== 'BTC') throw new Error('Financial replay currently supports BTC filters only');
  const account = input.executionWalletUsd == null ? null : new ReplayAccount({
    initialWallet: input.executionWalletUsd, maxRiskUsd: policy.maxEffectiveRiskPerTradeUsd,
    maxRiskPercent: policy.maxEffectiveRiskPerTradePercent, targetRiskPercent: policy.riskPerTradePercent,
    maxExposureUsd: policy.maxTotalExposureUsd, dailyLossPercent: policy.circuitDailyLossEnabled ? policy.dailyLossLimitPercent : 0,
    feePerSide: input.feePctPerSide ?? getAdaptiveFeePctPerSide(), slippageFraction: input.slippageFraction ?? .001,
    funding: input.fundingHistory ?? [],
    quantityFilters: input.quantityFilters,
    admissionReserve: input.admissionReserve,
    ...(input.modelPostCloseCooldown ? { postCloseCooldown: {
      winMinutes: getPostCloseSameSideCooldownMinutes(false),
      lossMinutes: getPostCloseSameSideCooldownMinutes(true),
    } } : {}),
  });
  const minSlPct = input.minSlPct ?? getRiskPolicy().minSlDistancePercent;
  const feePctPerSide = input.feePctPerSide ?? getAdaptiveFeePctPerSide();
  const maxHoldHours = input.maxHoldHours ?? 48;
  const rangeEdgeFraction = input.rangeEdgeFraction ?? getRangeSweepEdgeFraction();
  const microBosStrength = input.microBosStrength ?? getAdaptiveMicroBosStrength();
  const rangeRequireMicroBos =
    input.rangeRequireMicroBos ?? isRangeSweepRetestBosRequired();
  const microRequire1hAlign =
    input.microRequire1hAlign ?? isAlignedMicroBosRequire1hAlign();
  const rangeLong5mOnly = input.rangeLong5mOnly ?? isRangeSweepLong5mOnly();
  const master = (input.byTf['5m'] ?? []).filter(
    (bar) => bar.timestamp >= input.start.getTime() && candleCloseTimestamp(bar, '5m') <= input.end.getTime()
  );
  const stats = Object.fromEntries(KINDS.map((kind) => [kind, emptyStats()])) as Record<
    AdaptiveSetupKind,
    AdaptiveReplayStats
  >;
  const candidates = new Map<string, AdaptiveReplayCandidate>();
  const positions = new Map<AdaptiveSetupKind, ReplayPosition>();
  const seenWaves = new Set<string>();
  const outcomes: AdaptiveReplayOutcome[] = [];
  const lastProcessed = new Map<string, number>();
  let cached1h: { key: number | null; value: AdaptiveHtfState } | null = null;
  let cached15m: { key: number | null; value: AdaptiveHtfState } | null = null;
  let cachedStructure: {
    key: number | null;
    value: ReturnType<typeof classifyStructureBias>;
  } | null = null;

  for (const bar of master) {
    const decisionTs = candleCloseTimestamp(bar, '5m');
    account?.advance(decisionTs);
    const htf1hCandles = closedCandlesUpTo(input.byTf['1h'] ?? [], decisionTs, '1h', 150);
    const htf15mCandles = closedCandlesUpTo(input.byTf['15m'] ?? [], decisionTs, '15m', 150);
    const structureCandles = closedCandlesUpTo(
      input.byTf['4h'] ?? [],
      decisionTs,
      '4h',
      getV3StructureBiasCandleLimit()
    );
    const key1h = htf1hCandles.at(-1)?.timestamp ?? null;
    const key15m = htf15mCandles.at(-1)?.timestamp ?? null;
    const keyStructure = structureCandles.at(-1)?.timestamp ?? null;
    if (!cached1h || cached1h.key !== key1h) {
      cached1h = { key: key1h, value: state(htf1hCandles, '1h') };
    }
    if (!cached15m || cached15m.key !== key15m) {
      cached15m = { key: key15m, value: state(htf15mCandles, '15m') };
    }
    if (!cachedStructure || cachedStructure.key !== keyStructure) {
      cachedStructure = {
        key: keyStructure,
        value: classifyStructureBias(structureCandles, {
          strength: getV3StructureBiasStrength(),
        }),
      };
    }
    const htf1h = cached1h.value;
    const htf15m = cached15m.value;
    const structure = cachedStructure.value;

    for (const [kind, position] of [...positions.entries()]) {
      if (bar.timestamp <= position.entryBarOpenMs) continue;
      position.barsHeld += 1;
      const slHit = position.side === 'long'
        ? bar.low <= position.stopLoss
        : bar.high >= position.stopLoss;
      const tpHit = position.side === 'long'
        ? bar.high >= position.takeProfit
        : bar.low <= position.takeProfit;
      let closePrice: number | null = null;
      let reason: AdaptiveReplayOutcome['closeReason'] | null = null;
      // Conservative same-bar ordering, identical to the existing simulator.
      if (slHit) {
        closePrice = position.stopLoss;
        reason = 'stop_loss';
      } else if (tpHit) {
        closePrice = position.takeProfit;
        reason = 'take_profit';
      } else if (decisionTs - position.confirmedAt >= maxHoldHours * 3_600_000) {
        closePrice = bar.close;
        reason = 'max_hold';
      }
      if (reason && closePrice != null) {
        const outcome = closePosition(position, bar, closePrice, reason, feePctPerSide);
        if (account) { outcome.financial = account.close(kind, closePrice, decisionTs); outcome.netR = outcome.financial.netR; }
        outcomes.push(outcome);
        positions.delete(kind);
      }
    }

    for (const timeframe of ['15m', '5m'] as const) {
      const localCandles = closedCandlesUpTo(input.byTf[timeframe] ?? [], decisionTs, timeframe, 150);
      const latest = localCandles.at(-1);
      if (!latest || candleCloseTimestamp(latest, timeframe) !== decisionTs) continue;
      if (lastProcessed.get(timeframe) === latest.timestamp) continue;
      lastProcessed.set(timeframe, latest.timestamp);

      for (const [slot, candidate] of [...candidates.entries()]) {
        if (candidate.timeframe !== timeframe || latest.timestamp <= candidate.breakoutBarOpenMs) continue;
        if (decisionTs >= candidate.expiresAt) {
          stats[candidate.kind].expired += 1;
          candidates.delete(slot);
          continue;
        }
        const invalidation = 0.0025;
        const invalidated = candidate.side === 'long'
          ? latest.close < candidate.boundary * (1 - invalidation)
          : latest.close > candidate.boundary * (1 + invalidation);
        if (invalidated) {
          stats[candidate.kind].invalidated += 1;
          candidates.delete(slot);
          continue;
        }
        const tolerance = 0.0015;
        const touches = candidate.side === 'long'
          ? latest.low <= candidate.boundary * (1 + tolerance)
          : latest.high >= candidate.boundary * (1 - tolerance);
        const holds = candidate.side === 'long'
          ? latest.close >= candidate.boundary
          : latest.close <= candidate.boundary;
        if (!touches || !holds || positions.has(candidate.kind)) continue;
        if (!candidatePassesRetest({
          candidate,
          candle: latest,
          localCandles,
          htf1h,
          htf15m,
          microBosStrength,
          rangeRequireMicroBos,
        })) {
          continue;
        }
        const rr = input.rrByKind?.[candidate.kind] ?? getAdaptiveSetupRr(candidate.kind);
        const entry = latest.close;
        const riskDistance = entry * minSlPct;
        const target = candidate.side === 'long' ? entry + riskDistance * rr : entry - riskDistance * rr;
        if (input.requireRangeTargetRoom && candidate.kind === 'range_sweep_reclaim' &&
            !hasRangeTargetRoom({ side: candidate.side, entry, target,
              rangeLow: candidate.context.range_low, rangeHigh: candidate.context.range_high })) continue;
        input.onConfirmed?.(candidate, decisionTs, entry);
        if (input.collectOnly) {
          stats[candidate.kind].confirmed += 1;
          candidates.delete(slot);
          continue;
        }
        if (account) {
          const admission = account.tryOpen({ key: candidate.kind, side: candidate.side, entry,
            stopLoss: candidate.side === 'long' ? entry - riskDistance : entry + riskDistance, time: decisionTs });
          if (!admission.accepted) {
            if (input.consumeExecutionRejectedRetests &&
                (admission.reason === 'execution_risk' || admission.reason === 'daily_budget')) {
              candidates.delete(slot);
            }
            continue;
          }
        }
        positions.set(candidate.kind, {
          ...candidate,
          confirmedAt: decisionTs,
          entryBarOpenMs: latest.timestamp,
          entryPrice: entry,
          stopLoss: candidate.side === 'long' ? entry - riskDistance : entry + riskDistance,
          takeProfit: candidate.side === 'long'
            ? entry + riskDistance * rr
            : entry - riskDistance * rr,
          rr,
          barsHeld: 0,
        });
        stats[candidate.kind].confirmed += 1;
        candidates.delete(slot);
      }

      const setup = await analyzeSetupGate({ candles: localCandles, symbol, timeframe });
      if (setup.grade !== 'A' && setup.grade !== 'B') continue;
      const side = inferSetupTradeSide(setup, timeframe, localCandles);
      if (!side || !setup.playbookKey) continue;
      const evidence = setup.evidence.playbooks.find((row) =>
        setup.playbookKey === 'liquidity_sweep_reclaim'
          ? row.playbook === 'liquidity_sweep'
          : row.playbook === setup.playbookKey
      );
      const boundary = finite(
        side === 'long' ? evidence?.metrics.resistance : evidence?.metrics.support
      );
      const detected = detectAdaptiveSetup({
        side,
        timeframe,
        playbook: setup.playbookKey,
        grade: setup.grade,
        close: latest.close,
        boundary,
        structureBias: structure.bias,
        structureDetail: structure,
        htf1h,
        htf15m,
        selectedMetrics: evidence?.metrics ?? null,
        rangeEdgeFraction,
        microBosStrength,
        microRequire1hAlign,
        rangeLong5mOnly,
      });
      if (!detected) continue;
      const waveKey = `${detected.kind}:${side}:${Math.floor(decisionTs / 3_600_000)}`;
      const slot = `${detected.kind}:${timeframe}:${side}`;
      if (seenWaves.has(waveKey) || candidates.has(slot) || positions.has(detected.kind)) continue;
      const replayCandidate: AdaptiveReplayCandidate = {
        kind: detected.kind,
        side,
        timeframe,
        grade: setup.grade,
        boundary: detected.boundary,
        detectedAt: decisionTs,
        breakoutBarOpenMs: latest.timestamp,
        expiresAt:
          decisionTs +
          (input.ttlByKind?.[detected.kind] ?? getAdaptiveSetupTtlMinutes(detected.kind)) * 60_000,
        context: {
          ...detected.evidence,
          structure_bias: structure.bias,
          htf_1h_regime: htf1h.regime,
          htf_1h_direction: htf1h.trendDirection,
          htf_15m_regime: htf15m.regime,
          htf_15m_direction: htf15m.trendDirection,
        },
      };
      if (input.candidateFilter && !input.candidateFilter(replayCandidate)) continue;
      seenWaves.add(waveKey);
      candidates.set(slot, replayCandidate);
      stats[detected.kind].candidates += 1;
    }
  }

  const finalBar = master.at(-1);
  if (finalBar) {
    for (const position of positions.values()) {
      const outcome = closePosition(position, finalBar, finalBar.close, 'end_of_data', feePctPerSide);
      if (account) { outcome.financial = account.close(position.kind, finalBar.close, candleCloseTimestamp(finalBar, '5m')); outcome.netR = outcome.financial.netR; }
      outcomes.push(outcome);
    }
  }
  finishStats(stats, outcomes);
  return {
    ...(account ? { account: { initialWallet: input.executionWalletUsd!, endingWallet: account.wallet, blocks: account.blocks } } : {}),
    period: { start: input.start.toISOString(), end: input.end.toISOString() },
    config: {
      minSlPct,
      feePctPerSide,
      maxHoldHours,
      rangeEdgeFraction,
      microBosStrength,
      rangeRequireMicroBos,
      microRequire1hAlign,
      rangeLong5mOnly,
    },
    byKind: stats,
    outcomes,
  };
}
