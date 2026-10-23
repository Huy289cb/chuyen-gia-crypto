"use strict";
/**
 * Named testbed variants for walk-forward rule comparison (no runtime side effects).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TESTBED_VARIANTS = void 0;
exports.resolveTestbedVariant = resolveTestbedVariant;
exports.TESTBED_VARIANTS = {
    baseline: {
        id: 'baseline',
        label: 'Current env policy + tiered loss-streak cooldown',
        enableCooldown: true,
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
    'relax-b70-trend-sweep': {
        id: 'relax-b70-trend-sweep',
        label: 'B=0.70 sweep only; trend + structure/BOS + pullback unchanged',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        enableCooldown: true,
    },
    'relax-b70-trend-both': {
        id: 'relax-b70-trend-both',
        label: 'B=0.70 sweep+breakout; trend + structure/BOS + pullback unchanged',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim', 'breakout_volume'],
        enableCooldown: true,
    },
    'relax-b70-trend-breakout': {
        id: 'relax-b70-trend-breakout',
        label: 'B=0.70 breakout only; trend + structure/BOS + pullback unchanged',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['breakout_volume'],
        enableCooldown: true,
    },
    'relax-b70-no-bos': {
        id: 'relax-b70-no-bos',
        label: 'B=0.70 sweep; trend + directional structure, BOS not required',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        structureShortRequireBos: false,
        structureLongRequireBos: false,
        enableCooldown: true,
    },
    'relax-b70-range-sweep': {
        id: 'relax-b70-range-sweep',
        label: 'B=0.70 sweep; range allowed only for sweep; structure/BOS retained',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        allowedRegimes: ['trend', 'range'],
        blockRangeEntries: false,
        skipHtfTrendForRange: true,
        rangeAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        enableCooldown: true,
    },
    'relax-b70-range-no-bos': {
        id: 'relax-b70-range-no-bos',
        label: 'B=0.70 range sweep; directional structure retained, BOS not required',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        allowedRegimes: ['trend', 'range'],
        blockRangeEntries: false,
        skipHtfTrendForRange: true,
        rangeAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        structureShortRequireBos: false,
        structureLongRequireBos: false,
        enableCooldown: true,
    },
    'relax-b70-range-pb050': {
        id: 'relax-b70-range-pb050',
        label: 'B=0.70 range sweep; BOS retained; pullback chase band widened to 0.50%',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        allowedRegimes: ['trend', 'range'],
        blockRangeEntries: false,
        skipHtfTrendForRange: true,
        rangeAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        pullbackMaxAbovePct: 0.5,
        breakoutPullbackMaxAbovePct: 0.5,
        enableCooldown: true,
    },
    'relax-b70-range-no-bos-pb050': {
        id: 'relax-b70-range-no-bos-pb050',
        label: 'B=0.70 range sweep; no BOS; pullback chase band 0.50%',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        allowedRegimes: ['trend', 'range'],
        blockRangeEntries: false,
        skipHtfTrendForRange: true,
        rangeAllowedPlaybooks: ['liquidity_sweep_reclaim'],
        structureShortRequireBos: false,
        structureLongRequireBos: false,
        pullbackMaxAbovePct: 0.5,
        breakoutPullbackMaxAbovePct: 0.5,
        enableCooldown: true,
    },
    'relax-b70-range-both-no-bos-pb050': {
        id: 'relax-b70-range-both-no-bos-pb050',
        label: 'Upper screen: B range sweep+breakout; no BOS; pullback band 0.50%',
        minGrade: 'B',
        minConfidence: 0.7,
        gradeBMinConfidence: 0.7,
        gradeBAllowedPlaybooks: ['liquidity_sweep_reclaim', 'breakout_volume'],
        allowedRegimes: ['trend', 'range'],
        blockRangeEntries: false,
        skipHtfTrendForRange: true,
        rangeAllowedPlaybooks: ['liquidity_sweep_reclaim', 'breakout_volume'],
        structureShortRequireBos: false,
        structureLongRequireBos: false,
        pullbackMaxAbovePct: 0.5,
        breakoutPullbackMaxAbovePct: 0.5,
        enableCooldown: true,
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
};
function resolveTestbedVariant(id) {
    if (!id || id === 'baseline')
        return exports.TESTBED_VARIANTS.baseline;
    const v = exports.TESTBED_VARIANTS[id];
    if (!v) {
        const known = Object.keys(exports.TESTBED_VARIANTS).join(', ');
        throw new Error(`Unknown testbed variant "${id}". Known: ${known}`);
    }
    return v;
}
//# sourceMappingURL=testbed-variants.js.map