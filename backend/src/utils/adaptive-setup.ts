import type { StructureBias, StructureBiasResult } from '../config/v3-structure-bias-policy';
import { findStructureSwings, type StructureCandle } from './structure-bias';
import type { AdaptiveSetupKind } from '../config/adaptive-setup-policy';

export type AdaptiveSide = 'long' | 'short';

export interface AdaptiveHtfState {
  fresh: boolean;
  regime: 'trend' | 'range' | 'chop' | 'unknown';
  trendDirection: 'bullish' | 'bearish' | null;
  candles: StructureCandle[];
}

export interface AdaptiveDetectionInput {
  side: AdaptiveSide;
  timeframe: string;
  playbook: string;
  grade: string;
  close: number;
  boundary: number | null;
  structureBias: StructureBias | null;
  structureDetail: StructureBiasResult | null;
  htf1h: AdaptiveHtfState;
  htf15m: AdaptiveHtfState;
  selectedMetrics?: Record<string, unknown> | null;
  rangeEdgeFraction?: number;
  microBosStrength?: number;
  microRequire1hAlign?: boolean;
  rangeLong5mOnly?: boolean;
}

export interface AdaptiveDetectionResult {
  kind: AdaptiveSetupKind;
  boundary: number;
  evidence: Record<string, unknown>;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function expectedTrendDirection(side: AdaptiveSide): 'bullish' | 'bearish' {
  return side === 'long' ? 'bullish' : 'bearish';
}

export function isGradeBorBetter(grade: string): boolean {
  return grade.trim().toUpperCase() === 'A' || grade.trim().toUpperCase() === 'B';
}

/** Latest confirmed local pivot must be broken by the latest close. */
export function hasMicroBos(
  side: AdaptiveSide,
  candles: StructureCandle[],
  strength = 1
): { pass: boolean; level: number | null } {
  const last = candles.at(-1);
  if (!last || !Number.isFinite(last.close)) return { pass: false, level: null };
  const swings = findStructureSwings(candles, strength).filter(
    (row) => row.kind === (side === 'long' ? 'high' : 'low')
  );
  const pivot = swings.at(-1)?.price;
  if (!Number.isFinite(pivot)) return { pass: false, level: null };
  return {
    pass: side === 'long' ? last.close! > pivot! : last.close! < pivot!,
    level: pivot!,
  };
}

function structureFlipLevel(
  side: AdaptiveSide,
  detail: StructureBiasResult | null
): number | null {
  const values = side === 'long' ? detail?.swingHighs : detail?.swingLows;
  if (!values || values.length < 2) return null;
  return side === 'long' ? Math.max(...values) : Math.min(...values);
}

function structureAllowsRangeSide(side: AdaptiveSide, bias: StructureBias | null): boolean {
  return (
    bias === 'transition' ||
    (bias === 'bull' && side === 'long') ||
    (bias === 'bear' && side === 'short')
  );
}

function atRangeEdge(
  side: AdaptiveSide,
  price: number,
  candles: StructureCandle[],
  edgeFraction: number
): { pass: boolean; high: number; low: number; location: number } | null {
  const recent = candles.slice(-24);
  if (recent.length < 20) return null;
  const high = Math.max(...recent.map((row) => row.high));
  const low = Math.min(...recent.map((row) => row.low));
  const width = high - low;
  if (!(width > 0)) return null;
  const location = (price - low) / width;
  const pass = side === 'long' ? location <= edgeFraction : location >= 1 - edgeFraction;
  return { pass, high, low, location };
}

/**
 * Shared pure detector used by live shadow registration and historical replay.
 * Priority is intentional: a true counter-structure flip is more specific than
 * an aligned micro breakout, while range sweep uses a separate playbook.
 */
export function detectAdaptiveSetup(input: AdaptiveDetectionInput): AdaptiveDetectionResult | null {
  if (!isGradeBorBetter(input.grade) || !Number.isFinite(input.close)) return null;
  const expected = expectedTrendDirection(input.side);

  if (input.playbook === 'breakout_volume') {
    const flipBias = input.side === 'long' ? 'bear' : 'bull';
    const flipLevel = structureFlipLevel(input.side, input.structureDetail);
    if (
      input.structureBias === flipBias &&
      flipLevel != null &&
      (input.side === 'long' ? input.close > flipLevel : input.close < flipLevel) &&
      input.htf1h.fresh &&
      input.htf1h.regime === 'trend' &&
      input.htf1h.trendDirection === expected
    ) {
      return {
        kind: 'early_structure_flip',
        // Retest the actual 4h structure level that changed the thesis. The
        // local breakout consolidation can be materially below/above it and
        // caused false "retests" that never revisited the broken structure.
        boundary: flipLevel,
        evidence: {
          old_structure_bias: input.structureBias,
          broken_4h_swing: flipLevel,
          htf_direction: expected,
          ...(input.selectedMetrics ?? {}),
        },
      };
    }

    const aligned =
      (input.structureBias === 'bull' && input.side === 'long') ||
      (input.structureBias === 'bear' && input.side === 'short');
    const microBos = hasMicroBos(
      input.side,
      input.htf15m.candles,
      input.microBosStrength ?? 1
    );
    const htfNotOpposed =
      input.htf1h.fresh &&
      (input.microRequire1hAlign
        ? input.htf1h.regime === 'trend' && input.htf1h.trendDirection === expected
        : input.htf1h.trendDirection !==
          (input.side === 'long' ? 'bearish' : 'bullish'));
    if (
      input.timeframe === '5m' &&
      aligned &&
      htfNotOpposed &&
      input.htf15m.fresh &&
      microBos.pass &&
      input.boundary != null
    ) {
      return {
        kind: 'aligned_micro_bos',
        boundary: input.boundary,
        evidence: {
          structure_bias: input.structureBias,
          micro_bos_level: microBos.level,
          htf_1h_regime: input.htf1h.regime,
          htf_1h_direction: input.htf1h.trendDirection,
          ...(input.selectedMetrics ?? {}),
        },
      };
    }
    return null;
  }

  if (
    input.playbook === 'liquidity_sweep_reclaim' &&
    (!input.rangeLong5mOnly || (input.side === 'long' && input.timeframe === '5m')) &&
    input.htf1h.fresh &&
    input.htf1h.regime === 'range' &&
    structureAllowsRangeSide(input.side, input.structureBias)
  ) {
    const edge = atRangeEdge(
      input.side,
      input.close,
      input.htf1h.candles,
      input.rangeEdgeFraction ?? 0.3
    );
    const metrics = input.selectedMetrics ?? {};
    const boundary = finite(
      input.side === 'long' ? metrics.priorLow19 : metrics.priorHigh19
    );
    const reclaimed =
      boundary != null &&
      (input.side === 'long' ? input.close > boundary : input.close < boundary);
    if (edge?.pass && reclaimed) {
      return {
        kind: 'range_sweep_reclaim',
        boundary,
        evidence: {
          range_high: edge.high,
          range_low: edge.low,
          range_location: edge.location,
          reclaimed_level: boundary,
          ...metrics,
        },
      };
    }
  }
  return null;
}

export function retestCandleRejects(
  side: AdaptiveSide,
  candle: Pick<StructureCandle, 'high' | 'low' | 'close'> & { open?: number }
): boolean {
  if (!Number.isFinite(candle.open) || !Number.isFinite(candle.close)) return false;
  return side === 'long' ? candle.close! > candle.open! : candle.close! < candle.open!;
}
