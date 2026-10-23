import { describe, expect, it, afterEach } from 'vitest';
import {
  classifyStructureBias,
  findStructureSwings,
  hasBearishStructureBreak,
  hasBullishStructureBreak,
  type StructureCandle,
} from '../../src/utils/structure-bias';
import {
  evaluatePlaybookSideMatch,
  evaluateStructureSidePermission,
  formatLlmGateContext,
} from '../../src/config/v3-structure-bias-policy';
import { getMethodConfig } from '../../src/config/methods';
import { evaluateHtfSideAlign, isV3HtfSideAlignFailClosed } from '../../src/config/v3-entry-policy';
import { isBreakoutRegimeBypassEnabled } from '../../src/config/v3-regime-policy';

/** Build HH+HL series: rising swing highs/lows with quiet pads. */
function buildBullSeries(): StructureCandle[] {
  const out: StructureCandle[] = [];
  const pad = (n: number, mid: number) => {
    for (let i = 0; i < n; i++) out.push({ high: mid + 2, low: mid - 2, close: mid });
  };
  pad(4, 105);
  out.push({ high: 108, low: 90, close: 96 }); // L1=90
  pad(4, 110);
  out.push({ high: 130, low: 118, close: 125 }); // H1=130
  pad(4, 120);
  out.push({ high: 122, low: 105, close: 112 }); // L2=105 HL
  pad(4, 125);
  out.push({ high: 150, low: 135, close: 145 }); // H2=150 HH
  pad(4, 140); // close 140 > prior high 130 → BOS
  return out;
}

/** HH+HL then reject below prior swing high — relief, not longable BOS. */
function buildBullRejectSeries(): StructureCandle[] {
  const out = buildBullSeries();
  for (let i = 0; i < 6; i++) {
    out.push({ high: 128, low: 118, close: 122 }); // close 122 ≤ prior high 130
  }
  return out;
}

/** Build LH+LL series. */
function buildBearSeries(): StructureCandle[] {
  const out: StructureCandle[] = [];
  const pad = (n: number, mid: number) => {
    for (let i = 0; i < n; i++) out.push({ high: mid + 2, low: mid - 2, close: mid });
  };
  pad(4, 150);
  out.push({ high: 170, low: 155, close: 160 }); // H1=170
  pad(4, 145);
  out.push({ high: 140, low: 125, close: 128 }); // L1=125 (high not a swing)
  pad(4, 135);
  out.push({ high: 155, low: 140, close: 148 }); // H2=155 LH
  pad(4, 130);
  out.push({ high: 128, low: 100, close: 108 }); // L2=100 LL
  pad(4, 115); // close 115 < prior low 125 → BOS
  return out;
}

/** LH+LL then reclaim above prior swing low — pullback, not shortable BOS. */
function buildBearReclaimSeries(): StructureCandle[] {
  const out = buildBearSeries();
  for (let i = 0; i < 6; i++) {
    out.push({ high: 138, low: 128, close: 134 }); // close 134 > prior low 125
  }
  return out;
}

describe('structure-bias classifier', () => {
  it('finds fractal swings', () => {
    const c = buildBullSeries();
    const swings = findStructureSwings(c, 2);
    expect(swings.some((s) => s.kind === 'high')).toBe(true);
    expect(swings.some((s) => s.kind === 'low')).toBe(true);
  });

  it('classifies bull on HH+HL', () => {
    const r = classifyStructureBias(buildBullSeries(), { strength: 2 });
    expect(r.bias).toBe('bull');
  });

  it('classifies bear on LH+LL', () => {
    const r = classifyStructureBias(buildBearSeries(), { strength: 2 });
    expect(r.bias).toBe('bear');
  });

  it('transition when insufficient candles', () => {
    const r = classifyStructureBias([{ high: 1, low: 0 }], { strength: 2 });
    expect(r.bias).toBe('transition');
  });
});

describe('evaluateStructureSidePermission', () => {
  const envBackup = { ...process.env };
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('blocks long on bear structure', () => {
    process.env.V3_STRUCTURE_BIAS_ENABLED = 'true';
    const r = evaluateStructureSidePermission({
      side: 'long',
      candles: buildBearSeries(),
      enabled: true,
    });
    expect(r.pass).toBe(false);
    expect(r.bias).toBe('bear');
    expect(r.reason).toContain('V3_STRUCTURE_BIAS');
  });

  it('allows short on bear structure', () => {
    const r = evaluateStructureSidePermission({
      side: 'short',
      candles: buildBearSeries(),
      enabled: true,
    });
    expect(r.pass).toBe(true);
    expect(r.bias).toBe('bear');
  });

  it('blocks short on LH+LL reclaim (no BOS)', () => {
    process.env.V3_STRUCTURE_SHORT_REQUIRE_BOS = 'true';
    const candles = buildBearReclaimSeries();
    expect(classifyStructureBias(candles, { strength: 2 }).bias).toBe('bear');
    const r = evaluateStructureSidePermission({
      side: 'short',
      candles,
      enabled: true,
      shortRequireBos: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('V3_STRUCTURE_SHORT_REQUIRE_BOS');
  });

  it('allows long on bull structure with BOS', () => {
    const r = evaluateStructureSidePermission({
      side: 'long',
      candles: buildBullSeries(),
      enabled: true,
      longRequireBos: true,
    });
    expect(r.pass).toBe(true);
    expect(r.bias).toBe('bull');
  });

  it('blocks long on HH+HL reject (no BOS)', () => {
    process.env.V3_STRUCTURE_LONG_REQUIRE_BOS = 'true';
    const candles = buildBullRejectSeries();
    expect(classifyStructureBias(candles, { strength: 2 }).bias).toBe('bull');
    const r = evaluateStructureSidePermission({
      side: 'long',
      candles,
      enabled: true,
      longRequireBos: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('V3_STRUCTURE_LONG_REQUIRE_BOS');
  });

  it('BOS helper: close below prior low', () => {
    expect(hasBearishStructureBreak({ swingLows: [125, 100] }, 115)).toBe(true);
    expect(hasBearishStructureBreak({ swingLows: [125, 100] }, 130)).toBe(false);
  });

  it('BOS helper: close above prior high', () => {
    expect(hasBullishStructureBreak({ swingHighs: [130, 150] }, 140)).toBe(true);
    expect(hasBullishStructureBreak({ swingHighs: [130, 150] }, 120)).toBe(false);
  });

  it('blocks both on transition', () => {
    const flat = Array.from({ length: 30 }, () => ({ high: 100, low: 99, close: 99.5 }));
    const long = evaluateStructureSidePermission({ side: 'long', candles: flat, enabled: true });
    const short = evaluateStructureSidePermission({ side: 'short', candles: flat, enabled: true });
    expect(long.pass).toBe(false);
    expect(short.pass).toBe(false);
    expect(long.bias).toBe('transition');
  });
});

describe('evaluatePlaybookSideMatch', () => {
  it('blocks LLM long vs playbook short', () => {
    const r = evaluatePlaybookSideMatch({
      llmSide: 'long',
      playbookSide: 'short',
      enabled: true,
    });
    expect(r.pass).toBe(false);
  });

  it('passes when matched', () => {
    expect(
      evaluatePlaybookSideMatch({ llmSide: 'long', playbookSide: 'long', enabled: true }).pass
    ).toBe(true);
  });
});

describe('HTF side-align fail-closed (Phase B)', () => {
  const envBackup = { ...process.env };
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('fail-closed blocks when HTF not trend and no structure side', () => {
    process.env.V3_HTF_SIDE_ALIGN_FAIL_CLOSED = 'true';
    const r = evaluateHtfSideAlign({
      side: 'long',
      htfTf: '1h',
      htf: { regime: 'range', trendDirection: null },
      enabled: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('FAIL_CLOSED');
  });

  it('range HTF passes fail-closed when structure bear already allowed short', () => {
    process.env.V3_HTF_SIDE_ALIGN_FAIL_CLOSED = 'true';
    const r = evaluateHtfSideAlign({
      side: 'short',
      htfTf: '1h',
      htf: { regime: 'range', trendDirection: null },
      enabled: true,
      structureBias: 'bear',
    });
    expect(r.pass).toBe(true);
  });

  it('legacy fail-open when flag false', () => {
    process.env.V3_HTF_SIDE_ALIGN_FAIL_CLOSED = 'false';
    expect(isV3HtfSideAlignFailClosed()).toBe(false);
    const r = evaluateHtfSideAlign({
      side: 'long',
      htfTf: '1h',
      htf: { regime: 'chop', trendDirection: null },
      enabled: true,
      failClosed: false,
    });
    expect(r.pass).toBe(true);
  });
});

describe('formatLlmGateContext', () => {
  it('tells LLM to confirm playbook side or hold', () => {
    const text = formatLlmGateContext({
      timeframe: '15m',
      playbookKey: 'breakout',
      playbookSide: 'short',
      structureBias: 'bear',
      htfTf: '1h',
      htfRegime: 'range',
      htfDirection: null,
    });
    expect(text).toContain('GATE CONTEXT');
    expect(text).toContain('side short');
    expect(text).toContain('Structure bias (4h): bear');
    expect(text).toContain('HTF 1h: range/null');
    expect(text).toContain('Confirm ONLY "sell"');
    expect(text).toContain('or "hold"');
  });

  it('falls back to hold when playbook has no side', () => {
    const text = formatLlmGateContext({
      timeframe: '5m',
      playbookKey: 'unknown',
      playbookSide: null,
    });
    expect(text).toContain('Confirm ONLY "hold"');
  });
});

describe('kim_nghia system prompt', () => {
  it('is confirm/veto, not hunt-at-50%', () => {
    const prompt = getMethodConfig('kim_nghia').systemPrompt;
    expect(prompt).toContain('CONFIRM / VETO');
    expect(prompt).toContain('1h range không phải lý do HOLD');
    expect(prompt).not.toContain('PHẢI chọn BUY');
    expect(prompt).not.toContain('position_decisions');
    expect(prompt).not.toContain('order_block_distance');
  });
});

describe('breakout bypass with structure bias', () => {
  const envBackup = { ...process.env };
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('defaults on when trend-only even if structure bias enabled', () => {
    delete process.env.V3_BREAKOUT_REGIME_BYPASS;
    process.env.V3_STRUCTURE_BIAS_ENABLED = 'true';
    process.env.V3_ALLOWED_REGIMES = 'trend';
    expect(isBreakoutRegimeBypassEnabled()).toBe(true);
  });

  it('can force off', () => {
    process.env.V3_STRUCTURE_BIAS_ENABLED = 'true';
    process.env.V3_BREAKOUT_REGIME_BYPASS = 'false';
    expect(isBreakoutRegimeBypassEnabled()).toBe(false);
  });
});
