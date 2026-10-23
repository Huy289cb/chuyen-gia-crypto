export type AdaptiveSetupKind =
  | 'early_structure_flip'
  | 'aligned_micro_bos'
  | 'range_sweep_reclaim';

export type AdaptiveSetupMode = 'off' | 'shadow' | 'live';

export function getAdaptiveSetupMode(): AdaptiveSetupMode {
  const value = process.env.V3_ADAPTIVE_SETUP_MODE?.trim().toLowerCase();
  if (value === 'shadow' || value === 'live') return value;
  return 'off';
}

export function isAdaptiveSetupShadowEnabled(): boolean {
  return getAdaptiveSetupMode() !== 'off';
}

export function isAdaptiveSetupLiveEnabled(): boolean {
  return getAdaptiveSetupMode() === 'live';
}

export function isEarlyStructureFlipEnabled(): boolean {
  return process.env.V3_EARLY_STRUCTURE_FLIP_ENABLED !== 'false';
}

export function isAlignedMicroBosEnabled(): boolean {
  return process.env.V3_ALIGNED_MICRO_BOS_ENABLED !== 'false';
}

export function isRangeSweepReclaimEnabled(): boolean {
  return process.env.V3_RANGE_SWEEP_RECLAIM_ENABLED !== 'false';
}

export function isAlignedMicroBosRequire1hAlign(): boolean {
  return process.env.V3_ALIGNED_MICRO_BOS_REQUIRE_1H_ALIGN !== 'false';
}

export function isRangeSweepLong5mOnly(): boolean {
  return process.env.V3_RANGE_SWEEP_LONG_5M_ONLY !== 'false';
}

function positiveNumber(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getAdaptiveSetupTtlMinutes(kind: AdaptiveSetupKind): number {
  if (kind === 'range_sweep_reclaim') {
    return positiveNumber('V3_RANGE_SWEEP_RETEST_TTL_MINUTES', 90);
  }
  return positiveNumber('V3_ADAPTIVE_RETEST_TTL_MINUTES', 180);
}

export function getAdaptiveSetupRr(kind: AdaptiveSetupKind): number {
  if (kind === 'range_sweep_reclaim') {
    return positiveNumber('V3_RANGE_SWEEP_RR', 2);
  }
  if (kind === 'aligned_micro_bos') {
    return positiveNumber('V3_ALIGNED_MICRO_BOS_RR', 3);
  }
  return positiveNumber('V3_EARLY_STRUCTURE_FLIP_RR', 3);
}

/** Fraction of the 1h range considered an edge (0.30 = outer 30%). */
export function getRangeSweepEdgeFraction(): number {
  const value = positiveNumber('V3_RANGE_SWEEP_EDGE_FRACTION', 0.3);
  return Math.min(0.5, value);
}

export function getAdaptiveMicroBosStrength(): number {
  const value = Math.floor(positiveNumber('V3_ADAPTIVE_MICRO_BOS_STRENGTH', 1));
  return Math.max(1, Math.min(3, value));
}

export function isRangeSweepRetestBosRequired(): boolean {
  return process.env.V3_RANGE_SWEEP_RETEST_REQUIRE_BOS !== 'false';
}

export function isRangeSweepTargetRoomRequired(): boolean {
  return process.env.V3_RANGE_SWEEP_REQUIRE_TARGET_ROOM === 'true';
}

export function getAdaptiveFeePctPerSide(): number {
  return positiveNumber('V3_ADAPTIVE_FEE_PCT_PER_SIDE', 0.0004);
}
