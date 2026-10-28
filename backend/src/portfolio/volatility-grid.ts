/**
 * Phase 5: Volatility-Scaled BTC Grid Controller
 * ===============================================
 * Dynamically adjusts BTC dip-buying grid step sizes, take profit targets,
 * and crash gate thresholds based on 14-day Average True Range (ATR-14).
 * 
 * Mathematical Formulation:
 * 1. True Range: TR_t = max(High_t - Low_t, |High_t - Close_{t-1}|, |Low_t - Close_{t-1}|)
 * 2. ATR-14: Mean of TR over the past 14 days.
 * 3. ATR% = ATR_14 / CurrentPrice.
 * 4. Volatility Scaling Factor: volMultiplier = clamp(ATR% / BASELINE_ATR_PCT, 0.8, 1.5)
 * 5. Dynamic Grid Step: gridStepPct = clamp(BASE_STEP * volMultiplier, 0.015, 0.035)
 * 6. Dynamic Take Profit: gridTpPct = clamp(BASE_TP * volMultiplier, 0.025, 0.050)
 * 7. Dynamic Crash Gate: crashGatePct = clamp(BASE_CRASH * volMultiplier, 0.050, 0.090)
 * 
 * In high-volatility regimes: Grid expands to catch deeper dips safely and captures wider rebounds.
 * In low-volatility regimes: Grid tightens to capture smaller oscillations and increase capital turnover.
 */

export interface CandleData {
  high: number;
  low: number;
  close: number;
}

export interface VolatilityGridParams {
  atr14: number;
  atr14Pct: number;
  volMultiplier: number;
  gridStepPct: number;
  gridTpPct: number;
  crashGatePct: number;
  regime: 'low_volatility' | 'normal_volatility' | 'high_volatility';
  calculatedAt: string;
}

export const BASELINE_ATR_PCT = 0.020; // 2.0% baseline ATR on BTC
export const BASE_STEP_PCT = 0.020;     // 2.0% base dip step
export const BASE_TP_PCT = 0.035;       // 3.5% base take profit
export const BASE_CRASH_GATE_PCT = 0.06; // 6.0% base crash gate

export class VolatilityGridController {
  private lastParams: VolatilityGridParams | null = null;

  /**
   * Computes the 14-day Average True Range (ATR-14) from historical candles.
   * If high and low are identical or close-only, computes close-to-close True Range.
   */
  public computeAtr14(candles: CandleData[]): { atr14: number; atr14Pct: number } {
    if (candles.length < 2) {
      return { atr14: 0, atr14Pct: BASELINE_ATR_PCT };
    }

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];

      // Standard True Range
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trueRanges.push(tr);
    }

    const window = trueRanges.slice(-14);
    const atr14 = window.reduce((sum, v) => sum + v, 0) / window.length;
    const currentPrice = candles[candles.length - 1].close;
    const atr14Pct = currentPrice > 0 ? atr14 / currentPrice : BASELINE_ATR_PCT;

    return { atr14, atr14Pct };
  }

  /**
   * Computes the dynamic grid parameters for BTC based on ATR-14.
   */
  public computeGridParams(candles: CandleData[]): VolatilityGridParams {
    const { atr14, atr14Pct } = this.computeAtr14(candles);

    // Volatility scaling factor relative to baseline ATR
    const volMultiplier = Math.max(0.8, Math.min(1.5, atr14Pct / BASELINE_ATR_PCT));

    // Dynamic grid step clamped between 1.5% and 3.5%
    const gridStepPct = Number(Math.max(0.015, Math.min(0.035, BASE_STEP_PCT * volMultiplier)).toFixed(4));

    // Dynamic take profit clamped between 2.5% and 5.0%
    const gridTpPct = Number(Math.max(0.025, Math.min(0.050, BASE_TP_PCT * volMultiplier)).toFixed(4));

    // Dynamic crash gate clamped between 5.0% and 9.0%
    const crashGatePct = Number(Math.max(0.050, Math.min(0.090, BASE_CRASH_GATE_PCT * volMultiplier)).toFixed(4));

    let regime: 'low_volatility' | 'normal_volatility' | 'high_volatility' = 'normal_volatility';
    if (volMultiplier < 0.9) {
      regime = 'low_volatility';
    } else if (volMultiplier > 1.2) {
      regime = 'high_volatility';
    }

    const params: VolatilityGridParams = {
      atr14: Number(atr14.toFixed(2)),
      atr14Pct: Number((atr14Pct * 100).toFixed(2)),
      volMultiplier: Number(volMultiplier.toFixed(2)),
      gridStepPct,
      gridTpPct,
      crashGatePct,
      regime,
      calculatedAt: new Date().toISOString(),
    };

    this.lastParams = params;
    return params;
  }

  /**
   * Returns the most recent parameters or defaults if not yet calculated.
   */
  public getLastParams(): VolatilityGridParams {
    if (this.lastParams) return this.lastParams;
    return {
      atr14: 0,
      atr14Pct: Number((BASELINE_ATR_PCT * 100).toFixed(2)),
      volMultiplier: 1.0,
      gridStepPct: BASE_STEP_PCT,
      gridTpPct: BASE_TP_PCT,
      crashGatePct: BASE_CRASH_GATE_PCT,
      regime: 'normal_volatility',
      calculatedAt: new Date().toISOString(),
    };
  }
}
