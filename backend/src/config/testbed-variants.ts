/**
 * Named testbed variants for walk-forward rule comparison (no runtime side effects).
 */

export interface TestbedVariant {
  id: string;
  label: string;
  minGrade?: 'A' | 'B';
  minConfidence?: number;
  gradeBMinConfidence?: number;
  gradeBAllowedPlaybooks?: string[];
  allowedTimeframes?: string[];
  allowedPlaybooks?: string[];
  allowedSides?: Array<'long' | 'short'>;
  block5mWhen1hRange?: boolean;
  require5mHtfConfirm?: boolean;
  enableCooldown?: boolean;
}

export const TESTBED_VARIANTS: Record<string, TestbedVariant> = {
  baseline: {
    id: 'baseline',
    label: 'Current env policy (no overrides)',
  },
  'grade-a-only': {
    id: 'grade-a-only',
    label: 'MIN_SIGNAL_GRADE=A only',
    minGrade: 'A',
  },
  'grade-b-strict': {
    id: 'grade-b-strict',
    label: 'Grade B: conf>=0.85 + liquidity_sweep_reclaim only',
    minGrade: 'B',
    gradeBMinConfidence: 0.85,
    gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
  },
  'block-5m-range': {
    id: 'block-5m-range',
    label: 'Block 5m when 1h is range/chop',
    block5mWhen1hRange: true,
  },
  'require-15m-confirm': {
    id: 'require-15m-confirm',
    label: '5m requires 15m or 1h trend + same direction',
    require5mHtfConfirm: true,
  },
  cooldown: {
    id: 'cooldown',
    label: 'Tiered loss-streak cooldown (2→6h, 3→12h|EOD UTC)',
    enableCooldown: true,
  },
  combo: {
    id: 'combo',
    label: 'grade-a + block-5m-range + require-15m-confirm + cooldown',
    minGrade: 'A',
    block5mWhen1hRange: true,
    require5mHtfConfirm: true,
    enableCooldown: true,
  },
  'only-5m': {
    id: 'only-5m',
    label: 'Only 5m entries',
    allowedTimeframes: ['5m'],
  },
  'only-15m': {
    id: 'only-15m',
    label: 'Only 15m entries',
    allowedTimeframes: ['15m'],
  },
  'only-1h': {
    id: 'only-1h',
    label: 'Only 1h entries',
    allowedTimeframes: ['1h'],
  },
  'only-liquidity-sweep': {
    id: 'only-liquidity-sweep',
    label: 'Only liquidity_sweep_reclaim playbook',
    allowedPlaybooks: ['liquidity_sweep_reclaim'],
  },
  'only-breakout': {
    id: 'only-breakout',
    label: 'Only breakout_volume playbook',
    allowedPlaybooks: ['breakout_volume'],
  },
  'only-5m-breakout': {
    id: 'only-5m-breakout',
    label: 'Only 5m breakout_volume entries',
    allowedTimeframes: ['5m'],
    allowedPlaybooks: ['breakout_volume'],
  },
  'only-5m-liquidity-sweep': {
    id: 'only-5m-liquidity-sweep',
    label: 'Only 5m liquidity_sweep_reclaim entries',
    allowedTimeframes: ['5m'],
    allowedPlaybooks: ['liquidity_sweep_reclaim'],
  },
  'only-1h-liquidity-sweep': {
    id: 'only-1h-liquidity-sweep',
    label: 'Only 1h liquidity_sweep_reclaim entries',
    allowedTimeframes: ['1h'],
    allowedPlaybooks: ['liquidity_sweep_reclaim'],
  },
  'liquidity-sweep-cooldown': {
    id: 'liquidity-sweep-cooldown',
    label: 'liquidity_sweep_reclaim only + tiered cooldown',
    allowedPlaybooks: ['liquidity_sweep_reclaim'],
    enableCooldown: true,
  },
  'only-long': {
    id: 'only-long',
    label: 'Only long entries',
    allowedSides: ['long'],
  },
  'only-short': {
    id: 'only-short',
    label: 'Only short entries',
    allowedSides: ['short'],
  },
};

export function resolveTestbedVariant(id: string | undefined): TestbedVariant {
  if (!id || id === 'baseline') return TESTBED_VARIANTS.baseline;
  const v = TESTBED_VARIANTS[id];
  if (!v) {
    const known = Object.keys(TESTBED_VARIANTS).join(', ');
    throw new Error(`Unknown testbed variant "${id}". Known: ${known}`);
  }
  return v;
}
