import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTestbedVariant } from '../../src/config/testbed-variants';

describe('historical testbed production parity', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults R:R to production MIN_RR_RATIO=3 from env', async () => {
    vi.stubEnv('MIN_RR_RATIO', '3');
    vi.resetModules();
    const [{ resolveBacktestMinRr }, { getMethodConfig }] = await Promise.all([
      import('../../src/backtest/parity'),
      import('../../src/config/methods'),
    ]);

    expect(getMethodConfig('kim_nghia').autoEntry.minRRRatio).toBe(3);
    expect(resolveBacktestMinRr()).toBe(3);
  });

  it('accepts an explicit positive R:R override', async () => {
    const { resolveBacktestMinRr } = await import('../../src/backtest/parity');
    expect(resolveBacktestMinRr(1.75)).toBe(1.75);
    expect(() => resolveBacktestMinRr(0)).toThrow(/Invalid backtest min R:R/);
  });

  it('enables tiered loss cooldown in the baseline parity variant', () => {
    expect(resolveTestbedVariant('baseline').enableCooldown).toBe(true);
  });
});
