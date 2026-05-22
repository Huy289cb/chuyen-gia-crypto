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

export function getSignalGateAllowedRegimes(): SignalGateConfig['allowedRegimes'] {
  return getV3AllowedRegimes();
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
