import { describe, expect, it, afterEach } from 'vitest';
import {
  classifyStructureBias,
  findStructureSwings,
  type StructureCandle,
} from '../../src/utils/structure-bias';
import {
  evaluatePlaybookSideMatch,
  evaluateStructureSidePermission,
} from '../../src/config/v3-structure-bias-policy';
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
  pad(4, 140);
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
  pad(4, 115);
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

  it('fail-closed blocks when HTF not trend', () => {
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

describe('breakout bypass with structure bias', () => {
  const envBackup = { ...process.env };
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('defaults off when structure bias enabled', () => {
    delete process.env.V3_BREAKOUT_REGIME_BYPASS;
    process.env.V3_STRUCTURE_BIAS_ENABLED = 'true';
    process.env.V3_ALLOWED_REGIMES = 'trend';
    expect(isBreakoutRegimeBypassEnabled()).toBe(false);
  });

  it('can force on', () => {
    process.env.V3_STRUCTURE_BIAS_ENABLED = 'true';
    process.env.V3_BREAKOUT_REGIME_BYPASS = 'true';
    expect(isBreakoutRegimeBypassEnabled()).toBe(true);
  });
});
