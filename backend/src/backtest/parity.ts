import { getMethodConfig } from '../config/methods';

/** Resolve the same minimum R:R used by the production kim_nghia execution path. */
export function resolveBacktestMinRr(override?: number): number {
  if (override != null) {
    if (!Number.isFinite(override) || override <= 0) {
      throw new Error(`Invalid backtest min R:R: ${override}`);
    }
    return override;
  }
  return getMethodConfig('kim_nghia').autoEntry.minRRRatio;
}
