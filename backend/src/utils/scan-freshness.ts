/** Freshness policy for HTF snapshots consumed by live entry hard gates. */

export const DEFAULT_HTF_SCAN_MAX_AGE_MS = 10 * 60_000;

export function getHtfScanMaxAgeMs(): number {
  const value = parseInt(
    process.env.V3_HTF_SCAN_MAX_AGE_MS || String(DEFAULT_HTF_SCAN_MAX_AGE_MS),
    10
  );
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HTF_SCAN_MAX_AGE_MS;
}

export interface ScanFreshnessResult {
  pass: boolean;
  ageMs?: number;
  reason?: string;
}

/** Missing, invalid, future-dated, or stale timestamps fail closed. */
export function evaluateScanFreshness(
  timestamp: Date | number | null | undefined,
  options?: { nowMs?: number; maxAgeMs?: number; label?: string }
): ScanFreshnessResult {
  const label = options?.label ?? 'HTF';
  if (timestamp == null) {
    return { pass: false, reason: `${label} scan unavailable (missing timestamp)` };
  }

  const timestampMs = timestamp instanceof Date ? timestamp.getTime() : Number(timestamp);
  const nowMs = options?.nowMs ?? Date.now();
  const maxAgeMs = options?.maxAgeMs ?? getHtfScanMaxAgeMs();

  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) {
    return { pass: false, reason: `${label} scan unavailable (invalid timestamp)` };
  }

  const ageMs = nowMs - timestampMs;
  if (ageMs < 0) {
    return { pass: false, ageMs, reason: `${label} scan unavailable (future timestamp)` };
  }
  if (ageMs > maxAgeMs) {
    const ageMinutes = (ageMs / 60_000).toFixed(1);
    const maxMinutes = (maxAgeMs / 60_000).toFixed(1);
    return {
      pass: false,
      ageMs,
      reason: `${label} scan stale (${ageMinutes}m > ${maxMinutes}m max)`,
    };
  }

  return { pass: true, ageMs };
}
