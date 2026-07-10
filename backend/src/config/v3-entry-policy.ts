/**
 * V3 entry policy — PnL+ defensive defaults (trend-only, exposure cap).
 */

import type { SignalGateConfig } from '../services/signal-gate.service';
import { getRiskPolicy } from './risk-policy';

export type MarketRegime = 'trend' | 'range' | 'chop';

const ALL_REGIMES: MarketRegime[] = ['trend', 'range', 'chop'];

function parseAllowedRegimes(): MarketRegime[] {
  const raw = process.env.V3_ALLOWED_REGIMES?.trim();
  if (!raw) {
    return ['trend'];
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is MarketRegime => ALL_REGIMES.includes(s as MarketRegime));
  return parts.length > 0 ? parts : ['trend'];
}

/** Regimes that may proceed past signal gate (default: trend only). */
export function getV3AllowedRegimes(): MarketRegime[] {
  return parseAllowedRegimes();
}

export function isRegimeAllowedForEntry(regime: string): boolean {
  const allowed = getV3AllowedRegimes();
  if (!regime || regime === 'unknown') {
    return false;
  }
  return allowed.includes(regime as MarketRegime);
}

/** Block range/chop when V3_BLOCK_RANGE_ENTRIES is not false (default: block). */
export function isRangeEntryBlocked(regime: string): boolean {
  if (process.env.V3_BLOCK_RANGE_ENTRIES === 'false') {
    return false;
  }
  return regime === 'range' || regime === 'chop' || regime === 'unknown';
}

/** Effective regime for entry checks — matches signal gate pass logic (incl. breakout bypass). */
export function resolveGateRegimeFromSignal(
  signalResult: { gateRegime?: MarketRegime; setupResult: { regime: MarketRegime } } | null | undefined
): MarketRegime | 'unknown' {
  return signalResult?.gateRegime ?? signalResult?.setupResult.regime ?? 'unknown';
}

export function getSignalGateAllowedRegimes(): SignalGateConfig['allowedRegimes'] {
  if (isV3FastSampleMode()) {
    return ['trend', 'range'];
  }
  return getV3AllowedRegimes();
}

export function isV3FastSampleMode(): boolean {
  return process.env.V3_TEST_FAST_SAMPLE === 'true';
}

/**
 * Max notional (open + pending) — percent of wallet when MAX_EXPOSURE_PCT_OF_EQUITY set,
 * else fall back to MAX_TOTAL_EXPOSURE_USD from risk policy.
 */
export function resolveMaxTotalExposureUsd(walletBalance: number, fallbackUsd: number): number {
  const pctRaw = process.env.MAX_EXPOSURE_PCT_OF_EQUITY?.trim();
  if (pctRaw) {
    const pct = parseFloat(pctRaw);
    if (Number.isFinite(pct) && pct > 0) {
      return Math.max(1, walletBalance * pct);
    }
  }
  return fallbackUsd;
}

/** Reopen DB position after phantom close (default: disabled). */
export function isPhantomReopenEnabled(): boolean {
  return process.env.PHANTOM_REOPEN_ENABLED === 'true';
}

/** Allow same-side adds while total open+pending notional stays under max exposure cap. */
export function isV3ScaleInEnabled(): boolean {
  return process.env.V3_SCALE_IN_ENABLED !== 'false';
}

/** Evaluate Groq flip when new entry opposes open Binance exposure (default: enabled). */
export function isV3OppositeFlipEnabled(): boolean {
  return process.env.V3_OPPOSITE_FLIP_ENABLED !== 'false';
}

export function getV3OppositeFlipMinConfidence(): number {
  const v = parseFloat(process.env.V3_OPPOSITE_FLIP_MIN_CONFIDENCE || '0.85');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.85;
}

/** Min position notional USD (floor for sizing; default $200). */
export function getBinanceMinOrderNotionalUsd(): number {
  const v = parseFloat(process.env.BINANCE_MIN_ORDER_NOTIONAL_USD || '200');
  return Number.isFinite(v) && v > 0 ? v : 200;
}

/** Risk-based size floored at min notional, capped by exposure headroom. */
export function resolveTargetPositionNotionalUsd(input: {
  computedUsd: number;
  minNotionalUsd: number;
  remainingCapacityUsd: number;
}): number {
  const { computedUsd, minNotionalUsd, remainingCapacityUsd } = input;
  return Math.min(Math.max(computedUsd, minNotionalUsd), remainingCapacityUsd);
}

/** When set (e.g. `1h`), LTF pass must align with HTF trend regime before trade. */
export function getV3RequireHtfTrend(): string | null {
  const raw = process.env.V3_REQUIRE_HTF_TREND?.trim();
  if (!raw || raw === 'false') {
    return null;
  }
  return raw;
}

/**
 * Alternate TF for OR trend check when primary HTF is not trend (e.g. `15m` when primary is `1h`).
 * Used with V3_HTF_FLEX_LTF_ONLY for 5m/15m entries only.
 */
export function getV3HtfTrendAlt(): string | null {
  const raw = process.env.V3_HTF_TREND_ALT?.trim();
  if (!raw || raw === 'false' || raw === 'off') {
    return null;
  }
  return raw;
}

/** When true (default), HTF flex OR-guard applies only to 5m/15m entries — 1h still needs primary HTF trend. */
export function isV3HtfFlexLtfOnly(): boolean {
  return process.env.V3_HTF_FLEX_LTF_ONLY !== 'false';
}

export interface HtfTrendCheckResult {
  pass: boolean;
  reason?: string;
  primaryRegime?: string;
  altRegime?: string;
}

const HTF_FLEX_ENTRY_TFS = new Set(['5m', '15m']);

/**
 * Primary HTF must be trend; optionally allow alt TF trend for LTF entries (5m/15m).
 */
export function evaluateHtfTrendRequirement(input: {
  entryTimeframe: string;
  primaryTf: string;
  primaryRegime: string | null | undefined;
  altTf?: string | null;
  altRegime?: string | null | undefined;
}): HtfTrendCheckResult {
  const { entryTimeframe, primaryTf, primaryRegime, altTf, altRegime } = input;
  const primary = primaryRegime ?? 'unknown';

  if (primary === 'trend') {
    return { pass: true, primaryRegime: primary, altRegime: altRegime ?? undefined };
  }

  const alt = altRegime ?? 'unknown';
  const altEnabled = Boolean(altTf);
  const ltfEntry = HTF_FLEX_ENTRY_TFS.has(entryTimeframe);
  const flexApplies = altEnabled && alt === 'trend' && (!isV3HtfFlexLtfOnly() || ltfEntry);

  if (flexApplies && altTf) {
    return {
      pass: true,
      primaryRegime: primary,
      altRegime: alt,
      reason: `HTF ${primaryTf} ${primary} but ${altTf} trend (V3_HTF_TREND_ALT)`,
    };
  }

  if (altEnabled && alt === 'trend' && isV3HtfFlexLtfOnly() && !ltfEntry) {
    return {
      pass: false,
      primaryRegime: primary,
      altRegime: alt,
      reason: `HTF ${primaryTf} regime ${primary} !== trend (${entryTimeframe} entry requires primary HTF trend)`,
    };
  }

  return {
    pass: false,
    primaryRegime: primary,
    altRegime: altEnabled ? alt : undefined,
    reason: `HTF ${primaryTf} regime ${primary} !== trend (V3_REQUIRE_HTF_TREND)`,
  };
}

/** HTF used to align LTF regime for gate pass (default: same as V3_REQUIRE_HTF_TREND or 1h). */
export function getV3LtfAlignRegimeHtf(): string | null {
  const raw = process.env.V3_LTF_ALIGN_REGIME_HTF?.trim();
  if (raw === 'false' || raw === 'off') {
    return null;
  }
  if (raw) {
    return raw;
  }
  return getV3RequireHtfTrend();
}

export function isLtfRegimeAlignHtfEnabled(): boolean {
  return getV3LtfAlignRegimeHtf() != null;
}

const LTF_ALIGN_TFS = new Set(['5m', '15m']);

/** 5m/15m may pass regime filter when HTF is trend but local bar structure is range/chop. */
export function canAlignLtfRegimeFromHtf(timeframe: string, htfRegime: string | null | undefined): boolean {
  if (!isLtfRegimeAlignHtfEnabled() || !htfRegime) {
    return false;
  }
  if (!LTF_ALIGN_TFS.has(timeframe)) {
    return false;
  }
  return htfRegime === 'trend';
}

/** Block 5m entries when primary HTF (1h) is range/chop. */
export function isV3Block5mWhen1hRange(): boolean {
  return process.env.V3_BLOCK_5M_WHEN_1H_RANGE === 'true';
}

/** 5m must align with 15m or 1h trend direction (not just generic HTF trend pass). */
export function isV3Require5mHtfConfirm(): boolean {
  return process.env.V3_REQUIRE_5M_HTF_CONFIRM === 'true';
}

export type TrendDirection = 'bullish' | 'bearish';

export interface HtfConfirmTfState {
  regime: string | null | undefined;
  trendDirection: TrendDirection | null | undefined;
}

export interface FiveMEntryGuardResult {
  pass: boolean;
  reason?: string;
}

function sideToTrendDirection(side: 'long' | 'short'): TrendDirection {
  return side === 'long' ? 'bullish' : 'bearish';
}

function tfConfirmsSide(state: HtfConfirmTfState, side: 'long' | 'short'): boolean {
  if (state.regime !== 'trend') return false;
  const want = sideToTrendDirection(side);
  return state.trendDirection === want;
}

/**
 * 5m entry guards: optional block when 1h range; require 15m or 1h trend + same direction.
 * Used by testbed variants and runtime when env flags set.
 */
export function evaluate5mEntryGuards(input: {
  entryTimeframe: string;
  side: 'long' | 'short';
  tf1h: HtfConfirmTfState;
  tf15m: HtfConfirmTfState;
  block5mWhen1hRange?: boolean;
  require5mHtfConfirm?: boolean;
}): FiveMEntryGuardResult {
  const {
    entryTimeframe,
    side,
    tf1h,
    tf15m,
    block5mWhen1hRange = isV3Block5mWhen1hRange(),
    require5mHtfConfirm = isV3Require5mHtfConfirm(),
  } = input;

  if (entryTimeframe !== '5m') {
    return { pass: true };
  }

  if (block5mWhen1hRange && (tf1h.regime === 'range' || tf1h.regime === 'chop')) {
    return {
      pass: false,
      reason: `5m blocked: 1h regime ${tf1h.regime ?? 'unknown'} (V3_BLOCK_5M_WHEN_1H_RANGE)`,
    };
  }

  if (!require5mHtfConfirm) {
    return { pass: true };
  }

  const ok15 = tfConfirmsSide(tf15m, side);
  const ok1h = tfConfirmsSide(tf1h, side);
  if (ok15 || ok1h) {
    const via = ok15 && ok1h ? '15m+1h' : ok15 ? '15m' : '1h';
    return { pass: true, reason: `5m confirmed by ${via} ${sideToTrendDirection(side)} trend` };
  }

  return {
    pass: false,
    reason:
      `5m needs 15m or 1h trend aligned ${side} ` +
      `(15m=${tf15m.regime}/${tf15m.trendDirection ?? 'null'}, ` +
      `1h=${tf1h.regime}/${tf1h.trendDirection ?? 'null'})`,
  };
}

export interface GradePlaybookFilterResult {
  pass: boolean;
  reason?: string;
}

/** Grade/playbook filter for weak setups (env or testbed override). */
export function evaluateSetupGradePlaybookFilter(input: {
  grade: string;
  confidence: number;
  playbookKey: string | null;
  minGrade?: 'A' | 'B';
  gradeBMinConfidence?: number;
  gradeBAllowedPlaybooks?: string[];
}): GradePlaybookFilterResult {
  const policy = getRiskPolicy();
  const minGrade = input.minGrade ?? policy.minSignalGrade;
  const gradeOrder = { A: 0, B: 1, C: 2, D: 3 };
  const g = (input.grade || 'D') as keyof typeof gradeOrder;
  const min = gradeOrder[minGrade] ?? 0;
  if ((gradeOrder[g] ?? 3) > min) {
    return { pass: false, reason: `grade ${input.grade} below min ${minGrade}` };
  }

  const bMinConf = input.gradeBMinConfidence ?? parseOptionalFloat(process.env.V3_GRADE_B_MIN_CONFIDENCE);
  const bPlaybooks = input.gradeBAllowedPlaybooks ?? parsePlaybookList(process.env.V3_GRADE_B_ALLOWED_PLAYBOOKS);

  if (input.grade === 'B') {
    if (bMinConf != null && input.confidence < bMinConf) {
      return {
        pass: false,
        reason: `grade B confidence ${input.confidence.toFixed(2)} < ${bMinConf}`,
      };
    }
    if (bPlaybooks && bPlaybooks.length > 0) {
      const pk = input.playbookKey ?? '';
      if (!bPlaybooks.includes(pk)) {
        return { pass: false, reason: `grade B playbook ${pk || 'unknown'} not in allowlist` };
      }
    }
  }

  return { pass: true };
}

function parseOptionalFloat(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function parsePlaybookList(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}
