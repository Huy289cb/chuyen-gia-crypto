/**
 * Signal Gate Service
 * Determines whether to proceed to LLM analysis based on setup quality
 * Reduces Groq usage by filtering out weak signals before LLM call
 */

import { analyzeSetupGate, SetupGateInput, SetupGateResult } from '../analyzers/setup-gate.analyzer';

export interface SignalGateConfig {
  minGrade: 'A' | 'B' | 'C';
  minConfidence: number;
  allowedRegimes: ('trend' | 'range' | 'chop')[];
  enableDuplicateFilter: boolean;
}

export interface SignalGateOutput {
  pass: boolean;
  setupResult: SetupGateResult;
  reason: string;
  shouldCallGroq: boolean;
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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Generate cache key for signal
 */
function generateCacheKey(symbol: string, timeframe: string, candleHash: string): string {
  return `${symbol}_${timeframe}_${candleHash}`;
}

/**
 * Generate simple hash from candle data
 */
function generateCandleHash(candles: CandleData[]): string {
  const lastCandle = candles[candles.length - 1];
  return `${lastCandle.timestamp}_${lastCandle.high}_${lastCandle.low}_${lastCandle.close}`;
}

/**
 * Clean expired cache entries
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, value] of signalCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
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
  async evaluate(input: SetupGateInput): Promise<SignalGateOutput> {
    const { candles, symbol, timeframe } = input;

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
        console.log(`[SignalGate] Duplicate signal detected for ${symbol} ${timeframe}, using cached result`);
        return {
          pass: cached.result.grade === this.config.minGrade,
          setupResult: cached.result,
          reason: 'Duplicate signal - using cached result',
          shouldCallGroq: false
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
    const gradePass = this.isGradeAcceptable(setupResult.grade);
    const confidencePass = setupResult.confidence >= this.config.minConfidence;
    const regimePass = this.config.allowedRegimes.includes(setupResult.regime);

    const pass = gradePass && confidencePass && regimePass;

    let reason = '';
    if (!gradePass) {
      reason = `Grade ${setupResult.grade} below minimum ${this.config.minGrade}`;
    } else if (!confidencePass) {
      reason = `Confidence ${(setupResult.confidence * 100).toFixed(0)}% below minimum ${(this.config.minConfidence * 100).toFixed(0)}%`;
    } else if (!regimePass) {
      reason = `Regime ${setupResult.regime} not in allowed list`;
    } else {
      reason = 'Signal passes all gate conditions';
    }

    return {
      pass,
      setupResult,
      reason,
      shouldCallGroq: pass
    };
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

// Export singleton instance
export const signalGateService = new SignalGateService();
