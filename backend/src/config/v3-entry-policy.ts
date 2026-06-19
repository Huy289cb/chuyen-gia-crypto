/**
 * V3 entry policy — PnL+ defensive defaults (trend-only, exposure cap).
 */

import type { SignalGateConfig } from '../services/signal-gate.service';

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

/** When set (e.g. `1h`), LTF pass must align with HTF trend regime before trade. */
export function getV3RequireHtfTrend(): string | null {
  const raw = process.env.V3_REQUIRE_HTF_TREND?.trim();
  if (!raw || raw === 'false') {
    return null;
  }
  return raw;
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
