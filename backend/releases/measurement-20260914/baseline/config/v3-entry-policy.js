"use strict";
/**
 * V3 entry policy — PnL+ defensive defaults (trend-only, exposure cap).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getV3AllowedRegimes = getV3AllowedRegimes;
exports.isRegimeAllowedForEntry = isRegimeAllowedForEntry;
exports.isRangeEntryBlocked = isRangeEntryBlocked;
exports.resolveGateRegimeFromSignal = resolveGateRegimeFromSignal;
exports.getSignalGateAllowedRegimes = getSignalGateAllowedRegimes;
exports.isV3FastSampleMode = isV3FastSampleMode;
exports.resolveMaxTotalExposureUsd = resolveMaxTotalExposureUsd;
exports.isPhantomReopenEnabled = isPhantomReopenEnabled;
exports.isV3ScaleInEnabled = isV3ScaleInEnabled;
exports.isV3OppositeFlipEnabled = isV3OppositeFlipEnabled;
exports.getV3OppositeFlipMinConfidence = getV3OppositeFlipMinConfidence;
exports.getBinanceMinOrderNotionalUsd = getBinanceMinOrderNotionalUsd;
exports.getNotionalTolerancePercent = getNotionalTolerancePercent;
exports.minNotionalWithTolerance = minNotionalWithTolerance;
exports.maxNotionalWithTolerance = maxNotionalWithTolerance;
exports.resolveTargetPositionNotionalUsd = resolveTargetPositionNotionalUsd;
exports.getV3RequireHtfTrend = getV3RequireHtfTrend;
exports.getV3HtfTrendAlt = getV3HtfTrendAlt;
exports.isV3HtfFlexLtfOnly = isV3HtfFlexLtfOnly;
exports.evaluateHtfTrendRequirement = evaluateHtfTrendRequirement;
exports.getV3LtfAlignRegimeHtf = getV3LtfAlignRegimeHtf;
exports.isLtfRegimeAlignHtfEnabled = isLtfRegimeAlignHtfEnabled;
exports.canAlignLtfRegimeFromHtf = canAlignLtfRegimeFromHtf;
exports.isV3Block5mWhen1hRange = isV3Block5mWhen1hRange;
exports.isV3Require5mHtfConfirm = isV3Require5mHtfConfirm;
exports.isV3RequireHtfSideAlign = isV3RequireHtfSideAlign;
exports.getV3HtfSideAlignTf = getV3HtfSideAlignTf;
exports.isV3HtfSideAlignFailClosed = isV3HtfSideAlignFailClosed;
exports.evaluateHtfSideAlign = evaluateHtfSideAlign;
exports.isV3BlockEntryExtension = isV3BlockEntryExtension;
exports.getV3MaxEntryExtensionPct = getV3MaxEntryExtensionPct;
exports.getV3EntryExtensionTf = getV3EntryExtensionTf;
exports.getV3EntryExtensionBars = getV3EntryExtensionBars;
exports.evaluateEntryExtension = evaluateEntryExtension;
exports.isV3RequirePullback = isV3RequirePullback;
exports.getV3PullbackTf = getV3PullbackTf;
exports.getV3PullbackSmaPeriod = getV3PullbackSmaPeriod;
exports.getV3PullbackMaxAbovePct = getV3PullbackMaxAbovePct;
exports.getV3BreakoutPullbackMaxAbovePct = getV3BreakoutPullbackMaxAbovePct;
exports.getV3PullbackMaxBelowPct = getV3PullbackMaxBelowPct;
exports.smaFromCloses = smaFromCloses;
exports.evaluateTrendPullbackEntry = evaluateTrendPullbackEntry;
exports.evaluate5mEntryGuards = evaluate5mEntryGuards;
exports.evaluateSetupGradePlaybookFilter = evaluateSetupGradePlaybookFilter;
const risk_policy_1 = require("./risk-policy");
const ALL_REGIMES = ['trend', 'range', 'chop'];
function parseAllowedRegimes() {
    const raw = process.env.V3_ALLOWED_REGIMES?.trim();
    if (!raw) {
        return ['trend'];
    }
    const parts = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => ALL_REGIMES.includes(s));
    return parts.length > 0 ? parts : ['trend'];
}
/** Regimes that may proceed past signal gate (default: trend only). */
function getV3AllowedRegimes() {
    return parseAllowedRegimes();
}
function isRegimeAllowedForEntry(regime) {
    const allowed = getV3AllowedRegimes();
    if (!regime || regime === 'unknown') {
        return false;
    }
    return allowed.includes(regime);
}
/** Block range/chop when V3_BLOCK_RANGE_ENTRIES is not false (default: block). */
function isRangeEntryBlocked(regime) {
    if (process.env.V3_BLOCK_RANGE_ENTRIES === 'false') {
        return false;
    }
    return regime === 'range' || regime === 'chop' || regime === 'unknown';
}
/** Effective regime for entry checks — matches signal gate pass logic (incl. breakout bypass). */
function resolveGateRegimeFromSignal(signalResult) {
    return signalResult?.gateRegime ?? signalResult?.setupResult.regime ?? 'unknown';
}
function getSignalGateAllowedRegimes() {
    if (isV3FastSampleMode()) {
        return ['trend', 'range'];
    }
    return getV3AllowedRegimes();
}
function isV3FastSampleMode() {
    return process.env.V3_TEST_FAST_SAMPLE === 'true';
}
/**
 * Max notional (open + pending) — percent of wallet when MAX_EXPOSURE_PCT_OF_EQUITY set,
 * else fall back to MAX_TOTAL_EXPOSURE_USD from risk policy.
 */
function resolveMaxTotalExposureUsd(walletBalance, fallbackUsd) {
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
function isPhantomReopenEnabled() {
    return process.env.PHANTOM_REOPEN_ENABLED === 'true';
}
/** Allow same-side adds while total open+pending notional stays under max exposure cap. */
function isV3ScaleInEnabled() {
    return process.env.V3_SCALE_IN_ENABLED !== 'false';
}
/** Evaluate Groq flip when new entry opposes open Binance exposure (default: enabled). */
function isV3OppositeFlipEnabled() {
    return process.env.V3_OPPOSITE_FLIP_ENABLED !== 'false';
}
function getV3OppositeFlipMinConfidence() {
    const v = parseFloat(process.env.V3_OPPOSITE_FLIP_MIN_CONFIDENCE || '0.85');
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.85;
}
/** Min position notional USD (floor for sizing; default $200). */
function getBinanceMinOrderNotionalUsd() {
    const v = parseFloat(process.env.BINANCE_MIN_ORDER_NOTIONAL_USD || '200');
    return Number.isFinite(v) && v > 0 ? v : 200;
}
/** Allow small notional drift from rounding (default 15%). */
function getNotionalTolerancePercent() {
    const v = parseFloat(process.env.NOTIONAL_TOLERANCE_PERCENT || '15');
    return Number.isFinite(v) && v >= 0 && v <= 50 ? v : 15;
}
function minNotionalWithTolerance(minNotionalUsd, tolerancePercent) {
    const tol = tolerancePercent ?? getNotionalTolerancePercent();
    return minNotionalUsd * (1 - tol / 100);
}
function maxNotionalWithTolerance(maxNotionalUsd, tolerancePercent) {
    const tol = tolerancePercent ?? getNotionalTolerancePercent();
    return maxNotionalUsd * (1 + tol / 100);
}
/** Risk-based size floored at min notional, capped by exposure headroom. */
function resolveTargetPositionNotionalUsd(input) {
    const { computedUsd, minNotionalUsd, remainingCapacityUsd } = input;
    return Math.min(Math.max(computedUsd, minNotionalUsd), remainingCapacityUsd);
}
/** When set (e.g. `1h`), LTF pass must align with HTF trend regime before trade. */
function getV3RequireHtfTrend() {
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
function getV3HtfTrendAlt() {
    const raw = process.env.V3_HTF_TREND_ALT?.trim();
    if (!raw || raw === 'false' || raw === 'off') {
        return null;
    }
    return raw;
}
/** When true (default), HTF flex OR-guard applies only to 5m/15m entries — 1h still needs primary HTF trend. */
function isV3HtfFlexLtfOnly() {
    return process.env.V3_HTF_FLEX_LTF_ONLY !== 'false';
}
const HTF_FLEX_ENTRY_TFS = new Set(['5m', '15m']);
/**
 * Primary HTF must be trend; optionally allow alt TF trend for LTF entries (5m/15m).
 */
function evaluateHtfTrendRequirement(input) {
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
function getV3LtfAlignRegimeHtf() {
    const raw = process.env.V3_LTF_ALIGN_REGIME_HTF?.trim();
    if (raw === 'false' || raw === 'off') {
        return null;
    }
    if (raw) {
        return raw;
    }
    return getV3RequireHtfTrend();
}
function isLtfRegimeAlignHtfEnabled() {
    return getV3LtfAlignRegimeHtf() != null;
}
const LTF_ALIGN_TFS = new Set(['5m', '15m']);
/** 5m/15m may pass regime filter when HTF is trend but local bar structure is range/chop. */
function canAlignLtfRegimeFromHtf(timeframe, htfRegime) {
    if (!isLtfRegimeAlignHtfEnabled() || !htfRegime) {
        return false;
    }
    if (!LTF_ALIGN_TFS.has(timeframe)) {
        return false;
    }
    return htfRegime === 'trend';
}
/** Block 5m entries when primary HTF (1h) is range/chop. */
function isV3Block5mWhen1hRange() {
    return process.env.V3_BLOCK_5M_WHEN_1H_RANGE === 'true';
}
/** 5m must align with 15m or 1h trend direction (not just generic HTF trend pass). */
function isV3Require5mHtfConfirm() {
    return process.env.V3_REQUIRE_5M_HTF_CONFIRM === 'true';
}
/**
 * Block entries against primary HTF trend direction (all TFs).
 * Default on — stops longing into 1h bearish trend.
 */
function isV3RequireHtfSideAlign() {
    return process.env.V3_REQUIRE_HTF_SIDE_ALIGN !== 'false';
}
/** TF used for side-align (default V3_REQUIRE_HTF_TREND or 1h). */
function getV3HtfSideAlignTf() {
    const raw = process.env.V3_HTF_SIDE_ALIGN_TF?.trim();
    if (raw)
        return raw;
    return getV3RequireHtfTrend() ?? '1h';
}
function sideToTrendDirection(side) {
    return side === 'long' ? 'bullish' : 'bearish';
}
function tfConfirmsSide(state, side) {
    if (state.regime !== 'trend')
        return false;
    const want = sideToTrendDirection(side);
    return state.trendDirection === want;
}
/**
 * When fail-closed (default on): HTF must be trend + trendDirection matching side.
 * If structure already granted bull/bear, range/chop HTF does not veto (breakouts start in range).
 * Fail-closed still applies when structure is transition / unset.
 */
function isV3HtfSideAlignFailClosed() {
    return process.env.V3_HTF_SIDE_ALIGN_FAIL_CLOSED !== 'false';
}
/**
 * When HTF is in trend, side must match trendDirection.
 * Fail-closed: non-trend blocks unless structure already chose a side.
 */
function evaluateHtfSideAlign(input) {
    const enabled = input.enabled ?? isV3RequireHtfSideAlign();
    if (!enabled)
        return { pass: true };
    const failClosed = input.failClosed ?? isV3HtfSideAlignFailClosed();
    const { side, htfTf, htf } = input;
    if (htf.regime !== 'trend' || !htf.trendDirection) {
        const structureAllowsSide = (input.structureBias === 'bull' && side === 'long') ||
            (input.structureBias === 'bear' && side === 'short');
        if (!failClosed || structureAllowsSide) {
            return {
                pass: true,
                reason: structureAllowsSide
                    ? `${htfTf} ${htf.regime ?? 'unknown'} — structure ${input.structureBias} allows ${side}`
                    : undefined,
            };
        }
        return {
            pass: false,
            reason: `blocked: ${htfTf} regime ${htf.regime ?? 'unknown'}/${htf.trendDirection ?? 'null'} — need trend+direction for ${side} (V3_HTF_SIDE_ALIGN_FAIL_CLOSED)`,
        };
    }
    if (tfConfirmsSide(htf, side)) {
        return { pass: true, reason: `${htfTf} ${htf.trendDirection} aligns ${side}` };
    }
    return {
        pass: false,
        reason: `blocked: ${side} against ${htfTf} ${htf.trendDirection} trend (V3_REQUIRE_HTF_SIDE_ALIGN)`,
    };
}
/**
 * Block FOMO entries too far from the lookback range extreme (long from low, short from high).
 * Default **off** when pullback gate is on (replaced by EMA band). Force with V3_BLOCK_ENTRY_EXTENSION=true.
 */
function isV3BlockEntryExtension() {
    if (isV3RequirePullback()) {
        // Pullback replaces extension unless both forced on.
        return process.env.V3_BLOCK_ENTRY_EXTENSION === 'true';
    }
    return process.env.V3_BLOCK_ENTRY_EXTENSION !== 'false';
}
function getV3MaxEntryExtensionPct() {
    const v = parseFloat(process.env.V3_MAX_ENTRY_EXTENSION_PCT || '0.8');
    return Number.isFinite(v) && v > 0 ? v : 0.8;
}
function getV3EntryExtensionTf() {
    return process.env.V3_ENTRY_EXTENSION_TF?.trim() || '1h';
}
function getV3EntryExtensionBars() {
    const v = parseInt(process.env.V3_ENTRY_EXTENSION_BARS || '12', 10);
    return Number.isFinite(v) && v >= 3 ? v : 12;
}
/**
 * Pure anti-FOMO: long blocked when entry is too far above range low;
 * short blocked when entry is too far below range high.
 */
function evaluateEntryExtension(input) {
    const enabled = input.enabled ?? isV3BlockEntryExtension();
    if (!enabled)
        return { pass: true };
    const { side, entry, rangeHigh, rangeLow } = input;
    const maxPct = input.maxExtensionPct ?? getV3MaxEntryExtensionPct();
    const label = input.tfLabel ?? 'range';
    if (!Number.isFinite(entry) ||
        entry <= 0 ||
        !Number.isFinite(rangeHigh) ||
        !Number.isFinite(rangeLow) ||
        rangeHigh < rangeLow) {
        return { pass: true, reason: 'extension skip: invalid range' };
    }
    const extensionPct = side === 'long'
        ? ((entry - rangeLow) / entry) * 100
        : ((rangeHigh - entry) / entry) * 100;
    if (extensionPct <= maxPct) {
        return {
            pass: true,
            extensionPct,
            reason: `${side} extension ${extensionPct.toFixed(2)}% ≤ max ${maxPct}% (${label})`,
        };
    }
    return {
        pass: false,
        extensionPct,
        reason: `blocked: ${side} extension ${extensionPct.toFixed(2)}% > max ${maxPct}% ` +
            `from ${label} ${side === 'long' ? 'low' : 'high'} (V3_BLOCK_ENTRY_EXTENSION)`,
    };
}
/**
 * Trend pullback entry — require price near SMA (buy dip / sell rally), not chase.
 * Default on. Replaces crude range-extension FOMO filter.
 * Env: V3_REQUIRE_PULLBACK, V3_PULLBACK_*.
 */
function isV3RequirePullback() {
    return process.env.V3_REQUIRE_PULLBACK !== 'false';
}
function getV3PullbackTf() {
    return process.env.V3_PULLBACK_TF?.trim() || '15m';
}
function getV3PullbackSmaPeriod() {
    const v = parseInt(process.env.V3_PULLBACK_SMA_PERIOD || '20', 10);
    return Number.isFinite(v) && v >= 5 ? v : 20;
}
/** Long: max % entry may sit above SMA. Short: max % below SMA. Default 0.25. */
function getV3PullbackMaxAbovePct() {
    const v = parseFloat(process.env.V3_PULLBACK_MAX_ABOVE_PCT || '0.25');
    return Number.isFinite(v) && v >= 0 ? v : 0.25;
}
/**
 * Breakout pullback band (same default as trend pullback).
 * Was 1.25 (impulse privilege) — live chase losses; default 0.25 = no FOMO.
 */
function getV3BreakoutPullbackMaxAbovePct() {
    const v = parseFloat(process.env.V3_BREAKOUT_PULLBACK_MAX_ABOVE_PCT || '0.25');
    return Number.isFinite(v) && v >= 0 ? v : 0.25;
}
/** Long: max % entry may sit below SMA. Short: max % above SMA. Default 1.0. */
function getV3PullbackMaxBelowPct() {
    const v = parseFloat(process.env.V3_PULLBACK_MAX_BELOW_PCT || '1.0');
    return Number.isFinite(v) && v >= 0 ? v : 1.0;
}
/** SMA of last `period` closes; null if insufficient data. */
function smaFromCloses(closes, period) {
    if (!Number.isFinite(period) || period < 1 || closes.length < period)
        return null;
    const slice = closes.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    const sma = sum / period;
    return Number.isFinite(sma) && sma > 0 ? sma : null;
}
/**
 * Pure pullback band vs SMA.
 * Long: entry in [SMA - maxBelow, SMA + maxAbove] (as % of entry).
 * Short: mirrored (near/above SMA, not far below).
 */
function evaluateTrendPullbackEntry(input) {
    const enabled = input.enabled ?? isV3RequirePullback();
    if (!enabled)
        return { pass: true };
    const { side, entry } = input;
    const period = input.smaPeriod ?? getV3PullbackSmaPeriod();
    const maxAbove = input.maxAbovePct ?? getV3PullbackMaxAbovePct();
    const maxBelow = input.maxBelowPct ?? getV3PullbackMaxBelowPct();
    const label = input.tfLabel ?? `SMA${period}`;
    if (!Number.isFinite(entry) || entry <= 0) {
        return { pass: true, reason: 'pullback skip: invalid entry' };
    }
    const sma = smaFromCloses(input.closes, period);
    if (sma == null) {
        return { pass: true, reason: `pullback skip: need ${period} closes` };
    }
    const distPct = ((entry - sma) / entry) * 100;
    if (side === 'long') {
        if (distPct > maxAbove) {
            return {
                pass: false,
                sma,
                distPct,
                reason: `blocked: long ${distPct.toFixed(2)}% above ${label}=${sma.toFixed(1)} ` +
                    `(max +${maxAbove}%) (V3_REQUIRE_PULLBACK)`,
            };
        }
        if (distPct < -maxBelow) {
            return {
                pass: false,
                sma,
                distPct,
                reason: `blocked: long ${Math.abs(distPct).toFixed(2)}% below ${label}=${sma.toFixed(1)} ` +
                    `(max -${maxBelow}%) (V3_REQUIRE_PULLBACK)`,
            };
        }
        return {
            pass: true,
            sma,
            distPct,
            reason: `long pullback ${distPct.toFixed(2)}% vs ${label}=${sma.toFixed(1)}`,
        };
    }
    // short: want entry near/above SMA (rally to sell), not far below (chase dump)
    if (distPct < -maxAbove) {
        return {
            pass: false,
            sma,
            distPct,
            reason: `blocked: short ${Math.abs(distPct).toFixed(2)}% below ${label}=${sma.toFixed(1)} ` +
                `(max -${maxAbove}%) (V3_REQUIRE_PULLBACK)`,
        };
    }
    if (distPct > maxBelow) {
        return {
            pass: false,
            sma,
            distPct,
            reason: `blocked: short ${distPct.toFixed(2)}% above ${label}=${sma.toFixed(1)} ` +
                `(max +${maxBelow}%) (V3_REQUIRE_PULLBACK)`,
        };
    }
    return {
        pass: true,
        sma,
        distPct,
        reason: `short pullback ${distPct.toFixed(2)}% vs ${label}=${sma.toFixed(1)}`,
    };
}
/**
 * 5m entry guards: optional block when 1h range; require 15m or 1h trend + same direction.
 * Used by testbed variants and runtime when env flags set.
 */
function evaluate5mEntryGuards(input) {
    const { entryTimeframe, side, tf1h, tf15m, block5mWhen1hRange = isV3Block5mWhen1hRange(), require5mHtfConfirm = isV3Require5mHtfConfirm(), } = input;
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
        reason: `5m needs 15m or 1h trend aligned ${side} ` +
            `(15m=${tf15m.regime}/${tf15m.trendDirection ?? 'null'}, ` +
            `1h=${tf1h.regime}/${tf1h.trendDirection ?? 'null'})`,
    };
}
/** Grade/playbook filter for weak setups (env or testbed override). */
function evaluateSetupGradePlaybookFilter(input) {
    const policy = (0, risk_policy_1.getRiskPolicy)();
    const minGrade = input.minGrade ?? policy.minSignalGrade;
    const gradeOrder = { A: 0, B: 1, C: 2, D: 3 };
    const g = (input.grade || 'D');
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
function parseOptionalFloat(raw) {
    if (!raw?.trim())
        return null;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : null;
}
function parsePlaybookList(raw) {
    if (!raw?.trim())
        return null;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
}
//# sourceMappingURL=v3-entry-policy.js.map