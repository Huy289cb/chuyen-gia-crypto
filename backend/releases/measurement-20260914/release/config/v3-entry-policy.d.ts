/**
 * V3 entry policy — PnL+ defensive defaults (trend-only, exposure cap).
 */
import type { SignalGateConfig } from '../services/signal-gate.service';
export type MarketRegime = 'trend' | 'range' | 'chop';
/** Regimes that may proceed past signal gate (default: trend only). */
export declare function getV3AllowedRegimes(): MarketRegime[];
export declare function isRegimeAllowedForEntry(regime: string): boolean;
/** Block range/chop when V3_BLOCK_RANGE_ENTRIES is not false (default: block). */
export declare function isRangeEntryBlocked(regime: string): boolean;
/** Effective regime for entry checks — matches signal gate pass logic (incl. breakout bypass). */
export declare function resolveGateRegimeFromSignal(signalResult: {
    gateRegime?: MarketRegime;
    setupResult: {
        regime: MarketRegime;
    };
} | null | undefined): MarketRegime | 'unknown';
export declare function getSignalGateAllowedRegimes(): SignalGateConfig['allowedRegimes'];
export declare function isV3FastSampleMode(): boolean;
/**
 * Max notional (open + pending) — percent of wallet when MAX_EXPOSURE_PCT_OF_EQUITY set,
 * else fall back to MAX_TOTAL_EXPOSURE_USD from risk policy.
 */
export declare function resolveMaxTotalExposureUsd(walletBalance: number, fallbackUsd: number): number;
/** Reopen DB position after phantom close (default: disabled). */
export declare function isPhantomReopenEnabled(): boolean;
/** Allow same-side adds while total open+pending notional stays under max exposure cap. */
export declare function isV3ScaleInEnabled(): boolean;
/** Evaluate Groq flip when new entry opposes open Binance exposure (default: enabled). */
export declare function isV3OppositeFlipEnabled(): boolean;
export declare function getV3OppositeFlipMinConfidence(): number;
/** Min position notional USD (floor for sizing; default $200). */
export declare function getBinanceMinOrderNotionalUsd(): number;
/** Allow small notional drift from rounding (default 15%). */
export declare function getNotionalTolerancePercent(): number;
export declare function minNotionalWithTolerance(minNotionalUsd: number, tolerancePercent?: number): number;
export declare function maxNotionalWithTolerance(maxNotionalUsd: number, tolerancePercent?: number): number;
/** Risk-based size floored at min notional, capped by exposure headroom. */
export declare function resolveTargetPositionNotionalUsd(input: {
    computedUsd: number;
    minNotionalUsd: number;
    remainingCapacityUsd: number;
}): number;
/** When set (e.g. `1h`), LTF pass must align with HTF trend regime before trade. */
export declare function getV3RequireHtfTrend(): string | null;
/**
 * Alternate TF for OR trend check when primary HTF is not trend (e.g. `15m` when primary is `1h`).
 * Used with V3_HTF_FLEX_LTF_ONLY for 5m/15m entries only.
 */
export declare function getV3HtfTrendAlt(): string | null;
/** When true (default), HTF flex OR-guard applies only to 5m/15m entries — 1h still needs primary HTF trend. */
export declare function isV3HtfFlexLtfOnly(): boolean;
export interface HtfTrendCheckResult {
    pass: boolean;
    reason?: string;
    primaryRegime?: string;
    altRegime?: string;
}
/**
 * Primary HTF must be trend; optionally allow alt TF trend for LTF entries (5m/15m).
 */
export declare function evaluateHtfTrendRequirement(input: {
    entryTimeframe: string;
    primaryTf: string;
    primaryRegime: string | null | undefined;
    altTf?: string | null;
    altRegime?: string | null | undefined;
}): HtfTrendCheckResult;
/** HTF used to align LTF regime for gate pass (default: same as V3_REQUIRE_HTF_TREND or 1h). */
export declare function getV3LtfAlignRegimeHtf(): string | null;
export declare function isLtfRegimeAlignHtfEnabled(): boolean;
/** 5m/15m may pass regime filter when HTF is trend but local bar structure is range/chop. */
export declare function canAlignLtfRegimeFromHtf(timeframe: string, htfRegime: string | null | undefined): boolean;
/** Block 5m entries when primary HTF (1h) is range/chop. */
export declare function isV3Block5mWhen1hRange(): boolean;
/** 5m must align with 15m or 1h trend direction (not just generic HTF trend pass). */
export declare function isV3Require5mHtfConfirm(): boolean;
/**
 * Block entries against primary HTF trend direction (all TFs).
 * Default on — stops longing into 1h bearish trend.
 */
export declare function isV3RequireHtfSideAlign(): boolean;
/** TF used for side-align (default V3_REQUIRE_HTF_TREND or 1h). */
export declare function getV3HtfSideAlignTf(): string;
export type TrendDirection = 'bullish' | 'bearish';
export interface HtfConfirmTfState {
    regime: string | null | undefined;
    trendDirection: TrendDirection | null | undefined;
}
export interface FiveMEntryGuardResult {
    pass: boolean;
    reason?: string;
}
export interface HtfSideAlignResult {
    pass: boolean;
    reason?: string;
}
/**
 * When fail-closed (default on): HTF must be trend + trendDirection matching side.
 * If structure already granted bull/bear, range/chop HTF does not veto (breakouts start in range).
 * Fail-closed still applies when structure is transition / unset.
 */
export declare function isV3HtfSideAlignFailClosed(): boolean;
export type StructureBiasForAlign = 'bull' | 'bear' | 'transition';
/**
 * When HTF is in trend, side must match trendDirection.
 * Fail-closed: non-trend blocks unless structure already chose a side.
 */
export declare function evaluateHtfSideAlign(input: {
    side: 'long' | 'short';
    htfTf: string;
    htf: HtfConfirmTfState;
    enabled?: boolean;
    failClosed?: boolean;
    structureBias?: StructureBiasForAlign;
}): HtfSideAlignResult;
/**
 * Block FOMO entries too far from the lookback range extreme (long from low, short from high).
 * Default **off** when pullback gate is on (replaced by EMA band). Force with V3_BLOCK_ENTRY_EXTENSION=true.
 */
export declare function isV3BlockEntryExtension(): boolean;
export declare function getV3MaxEntryExtensionPct(): number;
export declare function getV3EntryExtensionTf(): string;
export declare function getV3EntryExtensionBars(): number;
export interface EntryExtensionResult {
    pass: boolean;
    reason?: string;
    extensionPct?: number;
}
/**
 * Pure anti-FOMO: long blocked when entry is too far above range low;
 * short blocked when entry is too far below range high.
 */
export declare function evaluateEntryExtension(input: {
    side: 'long' | 'short';
    entry: number;
    rangeHigh: number;
    rangeLow: number;
    maxExtensionPct?: number;
    enabled?: boolean;
    tfLabel?: string;
}): EntryExtensionResult;
/**
 * Trend pullback entry — require price near SMA (buy dip / sell rally), not chase.
 * Default on. Replaces crude range-extension FOMO filter.
 * Env: V3_REQUIRE_PULLBACK, V3_PULLBACK_*.
 */
export declare function isV3RequirePullback(): boolean;
export declare function getV3PullbackTf(): string;
export declare function getV3PullbackSmaPeriod(): number;
/** Long: max % entry may sit above SMA. Short: max % below SMA. Default 0.25. */
export declare function getV3PullbackMaxAbovePct(): number;
/**
 * Breakout pullback band (same default as trend pullback).
 * Was 1.25 (impulse privilege) — live chase losses; default 0.25 = no FOMO.
 */
export declare function getV3BreakoutPullbackMaxAbovePct(): number;
/** Long: max % entry may sit below SMA. Short: max % above SMA. Default 1.0. */
export declare function getV3PullbackMaxBelowPct(): number;
export interface TrendPullbackResult {
    pass: boolean;
    reason?: string;
    sma?: number;
    distPct?: number;
}
/** SMA of last `period` closes; null if insufficient data. */
export declare function smaFromCloses(closes: number[], period: number): number | null;
/**
 * Pure pullback band vs SMA.
 * Long: entry in [SMA - maxBelow, SMA + maxAbove] (as % of entry).
 * Short: mirrored (near/above SMA, not far below).
 */
export declare function evaluateTrendPullbackEntry(input: {
    side: 'long' | 'short';
    entry: number;
    closes: number[];
    smaPeriod?: number;
    maxAbovePct?: number;
    maxBelowPct?: number;
    enabled?: boolean;
    tfLabel?: string;
}): TrendPullbackResult;
/**
 * 5m entry guards: optional block when 1h range; require 15m or 1h trend + same direction.
 * Used by testbed variants and runtime when env flags set.
 */
export declare function evaluate5mEntryGuards(input: {
    entryTimeframe: string;
    side: 'long' | 'short';
    tf1h: HtfConfirmTfState;
    tf15m: HtfConfirmTfState;
    block5mWhen1hRange?: boolean;
    require5mHtfConfirm?: boolean;
}): FiveMEntryGuardResult;
export interface GradePlaybookFilterResult {
    pass: boolean;
    reason?: string;
}
/** Grade/playbook filter for weak setups (env or testbed override). */
export declare function evaluateSetupGradePlaybookFilter(input: {
    grade: string;
    confidence: number;
    playbookKey: string | null;
    minGrade?: 'A' | 'B';
    gradeBMinConfidence?: number;
    gradeBAllowedPlaybooks?: string[];
}): GradePlaybookFilterResult;
//# sourceMappingURL=v3-entry-policy.d.ts.map