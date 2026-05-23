/**
 * Setup Gate Analyzer
 */

import { getSignalGateWindows } from '../config/signal-gate-windows';
import { analyzeLiquiditySweep } from './liquidity-sweep.analyzer';
import { analyzeBreakoutVolume } from './breakout-volume.analyzer';
import { computeRegimeEvidence } from './market-regime.analyzer';
import type { SetupGateEvidence } from './setup-gate.types';
import { formatSetupGateDetail } from '../utils/setup-gate-evidence';

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface SetupGateResult {
  playbookKey: string | null;
  grade: 'A' | 'B' | 'C' | 'D';
  confidence: number;
  regime: 'trend' | 'range' | 'chop';
  reason: string;
  /** Full scan evidence (numbers from this candle window) */
  evidence: SetupGateEvidence;
  /** Multi-line detail for UI / Telegram */
  detailReason: string;
}

export interface SetupGateInput {
  candles: CandleData[];
  symbol: string;
  timeframe: string;
}

function buildEvidence(
  input: SetupGateInput,
  regimeEvidence: ReturnType<typeof computeRegimeEvidence>,
  liquiditySweep: ReturnType<typeof analyzeLiquiditySweep>,
  breakoutVolume: ReturnType<typeof analyzeBreakoutVolume>
): SetupGateEvidence {
  const last = input.candles[input.candles.length - 1];
  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    candleCount: input.candles.length,
    lastCandleTime: last?.timestamp ?? null,
    price: last?.close ?? regimeEvidence.currentPrice,
    regime: regimeEvidence,
    playbooks: [liquiditySweep.evidence, breakoutVolume.evidence],
  };
}

function withDetail(
  base: Omit<SetupGateResult, 'evidence' | 'detailReason'>,
  evidence: SetupGateEvidence
): SetupGateResult {
  return {
    ...base,
    evidence,
    detailReason: formatSetupGateDetail(evidence),
  };
}

export async function analyzeSetupGate(input: SetupGateInput): Promise<SetupGateResult> {
  const { candles, timeframe } = input;
  const windows = getSignalGateWindows(timeframe);

  if (candles.length < windows.minCandles) {
    const regimeEvidence = computeRegimeEvidence(candles, {
      regimeBars: windows.regimeBars,
      timeframe,
    });
    const emptyPb = {
      playbook: 'liquidity_sweep' as const,
      detected: false,
      grade: 'D' as const,
      summary: 'Chưa đủ nến để phân tích',
      metrics: {},
    };
    const evidence = buildEvidence(
      input,
      regimeEvidence,
      {
        detected: false,
        grade: 'D',
        confidence: 0,
        reason: 'Insufficient data',
        sweepType: null,
        evidence: emptyPb,
      },
      {
        detected: false,
        grade: 'D',
        confidence: 0,
        reason: 'Insufficient data',
        direction: null,
        evidence: { ...emptyPb, playbook: 'breakout_volume' },
      }
    );
    return withDetail(
      {
        playbookKey: null,
        grade: 'D',
        confidence: 0,
        regime: 'chop',
        reason: `Thiếu dữ liệu: ${candles.length}/${windows.minCandles} nến`,
      },
      evidence
    );
  }

  const regimeEvidence = computeRegimeEvidence(candles, {
    regimeBars: windows.regimeBars,
    timeframe,
  });
  const regime = regimeEvidence.regime;
  const liquiditySweep = analyzeLiquiditySweep(candles, { priorBars: windows.sweepPriorBars });
  const breakoutVolume = analyzeBreakoutVolume(candles, { windowBars: windows.breakoutBars });
  const evidence = buildEvidence(input, regimeEvidence, liquiditySweep, breakoutVolume);

  if (regime === 'chop') {
    return withDetail(
      {
        playbookKey: null,
        grade: 'D',
        confidence: 0,
        regime: 'chop',
        reason: regimeEvidence.matchedRule,
      },
      evidence
    );
  }

  let bestSetup: Omit<SetupGateResult, 'evidence' | 'detailReason'> = {
    playbookKey: null,
    grade: 'D',
    confidence: 0,
    regime,
    reason: 'Không có setup A/B — xem chi tiết playbook bên dưới',
  };

  if (liquiditySweep.detected && liquiditySweep.grade === 'A') {
    bestSetup = {
      playbookKey: 'liquidity_sweep_reclaim',
      grade: 'A',
      confidence: liquiditySweep.confidence,
      regime,
      reason: liquiditySweep.reason,
    };
  }

  if (breakoutVolume.detected && breakoutVolume.grade === 'A') {
    if (breakoutVolume.confidence > bestSetup.confidence) {
      bestSetup = {
        playbookKey: 'breakout_volume',
        grade: 'A',
        confidence: breakoutVolume.confidence,
        regime,
        reason: breakoutVolume.reason,
      };
    }
  }

  if (bestSetup.grade === 'D') {
    if (liquiditySweep.detected && liquiditySweep.grade === 'B') {
      bestSetup = {
        playbookKey: 'liquidity_sweep_reclaim',
        grade: 'B',
        confidence: liquiditySweep.confidence,
        regime,
        reason: liquiditySweep.reason,
      };
    }

    if (breakoutVolume.detected && breakoutVolume.grade === 'B') {
      if (breakoutVolume.confidence > bestSetup.confidence) {
        bestSetup = {
          playbookKey: 'breakout_volume',
          grade: 'B',
          confidence: breakoutVolume.confidence,
          regime,
          reason: breakoutVolume.reason,
        };
      }
    }
  }

  return withDetail(bestSetup, evidence);
}
