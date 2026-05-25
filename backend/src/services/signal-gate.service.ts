/**
 * Signal Gate Service
 * Determines whether to proceed to LLM analysis based on setup quality
 * Reduces Groq usage by filtering out weak signals before LLM call
 */

import { analyzeSetupGate, SetupGateInput, SetupGateResult } from '../analyzers/setup-gate.analyzer';
import { getRiskPolicy } from '../config/risk-policy';
import {
  canAlignLtfRegimeFromHtf,
  getSignalGateAllowedRegimes,
  isV3FastSampleMode,
} from '../config/v3-entry-policy';
import { getSignalGateCacheTtlMs } from '../config/v3-schedulers';
import { regimeForGatePass, shouldBypassRegimeForBreakout } from '../config/v3-regime-policy';
import { formatSignalGateBlockReason } from '../utils/signal-gate-format';
import { generateCandleHash } from '../utils/candle-hash';
import type { MarketRegime } from '../analyzers/market-regime.analyzer';

export interface SignalGateConfig {
  minGrade: 'A' | 'B' | 'C' | 'D';
  minConfidence: number;
  allowedRegimes: ('trend' | 'range' | 'chop')[];
  enableDuplicateFilter: boolean;
}

export interface SignalGateOutput {
  pass: boolean;
  setupResult: SetupGateResult;
  reason: string;
  shouldCallGroq: boolean;
  /** True when this evaluation reused in-memory cache (not a fresh setup read). */
  isDuplicate: boolean;
  /** Regime used for pass/fail (may follow HTF when LTF aligned). */
  gateRegime?: MarketRegime;
}

export interface SignalGateEvaluateInput extends SetupGateInput {
  /** HTF regime from earlier scan in same cycle (e.g. 1h trend for 5m/15m). */
  htfRegime?: MarketRegime | null;
}

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

// Cache for duplicate signal detection
const signalCache = new Map<string, { timestamp: number; result: SetupGateResult }>();

function getCacheTtl(): number {
  return getSignalGateCacheTtlMs();
}

/**
 * Generate cache key for signal
 */
function generateCacheKey(symbol: string, timeframe: string, candleHash: string): string {
  return `${symbol}_${timeframe}_${candleHash}`;
}

/**
 * Clean expired cache entries
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, value] of signalCache.entries()) {
    if (now - value.timestamp > getCacheTtl()) {
      signalCache.delete(key);
    }
  }
}

/**
 * Default signal gate configuration
 */
const defaultConfig: SignalGateConfig = {
  minGrade: 'A',
  minConfidence: 0.75,
  allowedRegimes: ['trend', 'range'],
  enableDuplicateFilter: true
};

/**
 * Signal Gate Service
 * Evaluates whether a signal is strong enough to proceed to LLM analysis
 */
export class SignalGateService {
  private config: SignalGateConfig;

  constructor(config?: Partial<SignalGateConfig>) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Evaluate signal and determine if it should proceed to LLM
   */
  async evaluate(input: SignalGateEvaluateInput): Promise<SignalGateOutput> {
    const { candles, symbol, timeframe, htfRegime } = input;

    // Clean expired cache
    if (this.config.enableDuplicateFilter) {
      cleanExpiredCache();
    }

    // Generate candle hash for duplicate detection
    const candleHash = generateCandleHash(candles);
    const cacheKey = generateCacheKey(symbol, timeframe, candleHash);

    // Check cache for duplicate signal
    if (this.config.enableDuplicateFilter) {
      const cached = signalCache.get(cacheKey);
      if (cached) {
        // Use proper evaluation logic for the cached result
        const gateRegime = this.resolveGateRegime(
          timeframe,
          cached.result.regime,
          htfRegime,
          cached.result.playbookKey,
          cached.result.grade
        );
        const gradePass = this.isGradeAcceptable(cached.result.grade);
        const confidencePass = cached.result.confidence >= this.config.minConfidence;
        const regimePass = this.config.allowedRegimes.includes(gateRegime);
        const pass = gradePass && confidencePass && regimePass;

        console.log(`[SignalGate] Duplicate signal detected for ${symbol} ${timeframe}, using cached result. Pass: ${pass}`);
        return {
          pass,
          setupResult: cached.result,
          reason: 'Duplicate signal - using cached result',
          shouldCallGroq: false,
          isDuplicate: true,
          gateRegime,
        };
      }
    }

    // Analyze setup
    const setupResult = await analyzeSetupGate(input);

    // Cache the result
    if (this.config.enableDuplicateFilter) {
      signalCache.set(cacheKey, {
        timestamp: Date.now(),
        result: setupResult
      });
    }

    // Determine if signal passes gate
    const gateRegime = this.resolveGateRegime(
      timeframe,
      setupResult.regime,
      htfRegime,
      setupResult.playbookKey,
      setupResult.grade
    );
    const gradePass = this.isGradeAcceptable(setupResult.grade);
    const confidencePass = setupResult.confidence >= this.config.minConfidence;
    const regimePass = this.config.allowedRegimes.includes(gateRegime);

    const pass = gradePass && confidencePass && regimePass;

    let reason: string;
    if (pass) {
      const align =
        gateRegime !== setupResult.regime
          ? shouldBypassRegimeForBreakout(timeframe, setupResult.playbookKey, setupResult.grade)
            ? ` (breakout ${setupResult.grade} → gate trend; LTF ${setupResult.regime})`
            : ` (regime LTF ${setupResult.regime} → gate ${gateRegime})`
          : '';
      reason = `Signal passes all gate conditions${align}`;
    } else {
      reason = formatSignalGateBlockReason(
        { pass, setupResult, reason: '', shouldCallGroq: false, isDuplicate: false },
        this.config
      );
    }

    return {
      pass,
      setupResult,
      reason,
      shouldCallGroq: pass,
      isDuplicate: false,
      gateRegime,
    };
  }

  private resolveGateRegime(
    timeframe: string,
    localRegime: MarketRegime,
    htfRegime: MarketRegime | null | undefined,
    playbookKey: string | null,
    grade: 'A' | 'B' | 'C' | 'D'
  ): MarketRegime {
    return regimeForGatePass({
      timeframe,
      localRegime,
      htfRegime,
      playbookKey,
      grade,
      alignHtf: (tf, local, htf) => {
        if (
          canAlignLtfRegimeFromHtf(tf, htf) &&
          htf === 'trend' &&
          (local === 'range' || local === 'chop')
        ) {
          return 'trend';
        }
        return local;
      },
    });
  }

  /**
   * Check if grade meets minimum requirement
   */
  private isGradeAcceptable(grade: 'A' | 'B' | 'C' | 'D'): boolean {
    const gradeOrder = ['A', 'B', 'C', 'D'];
    const minIndex = gradeOrder.indexOf(this.config.minGrade);
    const gradeIndex = gradeOrder.indexOf(grade);
    return gradeIndex <= minIndex;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SignalGateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SignalGateConfig {
    return { ...this.config };
  }

  /**
   * Clear signal cache
   */
  clearCache(): void {
    signalCache.clear();
    console.log('[SignalGate] Cache cleared');
  }
}

function buildSignalGateConfigFromEnv(): Partial<SignalGateConfig> {
  const policy = getRiskPolicy();
  const minGrade = isV3FastSampleMode() ? 'C' : policy.minSignalGrade;
  return {
    minGrade: (['A', 'B', 'C', 'D'].includes(minGrade) ? minGrade : 'A') as SignalGateConfig['minGrade'],
    minConfidence: isV3FastSampleMode() ? 0.55 : policy.minSignalConfidence,
    allowedRegimes: getSignalGateAllowedRegimes(),
  };
}

// Export singleton instance (wired to MIN_SIGNAL_GRADE / MIN_SIGNAL_CONFIDENCE)
export const signalGateService = new SignalGateService(buildSignalGateConfigFromEnv());
