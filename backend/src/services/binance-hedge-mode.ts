/**
 * Binance Futures Hedge Mode Detection Service
 * 
 * Detects and validates the account's position mode (one-way vs hedge mode)
 * Ensures correct positionSide values are sent to avoid rejected orders
 */

import { getPositionRisk } from './binanceClient';

export type PositionMode = 'ONE_WAY' | 'HEDGE';
export type OrderIntent = 'OPEN' | 'CLOSE';

let detectedMode: PositionMode | null = null;
let detectionPromise: Promise<PositionMode> | null = null;

/**
 * Detect the account's position mode from Binance
 * 
 * Returns 'ONE_WAY' or 'HEDGE' based on the account's current mode
 * This is called ONCE at startup and cached
 */
async function detectPositionModeInternal(): Promise<PositionMode> {
  const client = {} as any; // Binance client is not needed for module functions

  try {
    // Get position risk for a symbol to determine mode
    // In hedge mode, we'll see both LONG and SHORT positions for the same symbol
    // In one-way mode, we'll only see one position per symbol
    const positions = await getPositionRisk(client, 'BTCUSDT');
    
    // Check if we have positions with positionSide set
    const hasPositionSide = positions.some((p: any) => p.positionSide && (p.positionSide === 'LONG' || p.positionSide === 'SHORT'));
    
    if (hasPositionSide) {
      detectedMode = 'HEDGE';
      console.log('[BinanceHedgeMode] Detected HEDGE mode (dual position side)');
    } else {
      detectedMode = 'ONE_WAY';
      console.log('[BinanceHedgeMode] Detected ONE_WAY mode (single position side)');
    }
    
    return detectedMode;
  } catch (error: any) {
    console.error('[BinanceHedgeMode] Failed to detect position mode:', error.message);
    // Default to ONE_WAY if detection fails
    detectedMode = 'ONE_WAY';
    console.log('[BinanceHedgeMode] Defaulting to ONE_WAY mode due to detection failure');
    return detectedMode;
  }
}

/**
 * Ensure position mode is detected (called once at startup)
 */
export async function ensurePositionModeDetected(): Promise<PositionMode> {
  if (detectedMode) {
    return detectedMode;
  }
  
  if (detectionPromise) {
    return detectionPromise;
  }
  
  detectionPromise = detectPositionModeInternal();
  return detectionPromise;
}

/**
 * Get the detected position mode (must be called after ensurePositionModeDetected)
 */
export function getPositionMode(): PositionMode {
  if (!detectedMode) {
    throw new Error('[BinanceHedgeMode] Position mode not detected. Call ensurePositionModeDetected() first.');
  }
  return detectedMode;
}

/**
 * Resolve the correct positionSide based on side, intent, and current position
 * 
 * @param side - Order side: 'BUY' or 'SELL'
 * @param intent - Order intent: 'OPEN' or 'CLOSE'
 * @param currentPosition - Current position info: { positionAmt: number, positionSide?: string }
 * @returns positionSide ('LONG' or 'SHORT') or null for ONE_WAY mode
 * @throws Error if context is missing or invalid
 */
export function resolvePositionSide(
  side: 'BUY' | 'SELL',
  intent: OrderIntent,
  currentPosition: { positionAmt: number; positionSide?: string } | null
): string | null {
  const mode = getPositionMode();
  
  // In ONE_WAY mode, positionSide should not be sent
  if (mode === 'ONE_WAY') {
    return null;
  }
  
  // In HEDGE mode, positionSide is REQUIRED
  if (mode === 'HEDGE') {
    // Validate inputs
    if (side !== 'BUY' && side !== 'SELL') {
      throw new Error(`[BinanceHedgeMode] Invalid side: ${side}. Must be 'BUY' or 'SELL'.`);
    }
    
    if (intent !== 'OPEN' && intent !== 'CLOSE') {
      throw new Error(`[BinanceHedgeMode] Invalid intent: ${intent}. Must be 'OPEN' or 'CLOSE'.`);
    }
    
    // For OPEN positions
    if (intent === 'OPEN') {
      // BUY -> LONG, SELL -> SHORT
      if (side === 'BUY') {
        return 'LONG';
      } else {
        return 'SHORT';
      }
    }
    
    // For CLOSE positions
    if (intent === 'CLOSE') {
      // Must have current position info
      if (!currentPosition) {
        throw new Error('[BinanceHedgeMode] Current position info required for CLOSE intent');
      }
      
      const { positionAmt, positionSide: currentSide } = currentPosition;
      
      // If we have positionSide from current position, use it
      if (currentSide && (currentSide === 'LONG' || currentSide === 'SHORT')) {
        return currentSide;
      }
      
      // Otherwise, infer from positionAmt
      // positionAmt > 0 means LONG position, positionAmt < 0 means SHORT position
      if (positionAmt > 0) {
        return 'LONG';
      } else if (positionAmt < 0) {
        return 'SHORT';
      } else {
        throw new Error('[BinanceHedgeMode] Cannot close position: positionAmt is 0 (no position to close)');
      }
    }
  }
  
  // Should never reach here
  throw new Error(`[BinanceHedgeMode] Unexpected mode: ${mode}`);
}

/**
 * Validate that positionSide is correctly set based on mode
 * 
 * @param positionSide - positionSide value to validate
 * @throws Error if validation fails
 */
export function validatePositionSide(positionSide: string | null): void {
  const mode = getPositionMode();
  
  if (mode === 'HEDGE') {
    if (!positionSide) {
      throw new Error('[BinanceHedgeMode] positionSide is REQUIRED in HEDGE mode');
    }
    if (positionSide !== 'LONG' && positionSide !== 'SHORT') {
      throw new Error(`[BinanceHedgeMode] Invalid positionSide: ${positionSide}. Must be 'LONG' or 'SHORT'.`);
    }
  } else if (mode === 'ONE_WAY') {
    if (positionSide) {
      throw new Error('[BinanceHedgeMode] positionSide must NOT be sent in ONE_WAY mode');
    }
  }
}

/**
 * Validate that the current mode is compatible with the expected mode
 * 
 * This can be used to warn users if they're trying to use hedge mode features
 * when their account is in one-way mode
 */
export function validateModeCompatibility(expectedMode: PositionMode): boolean {
  const mode = getPositionMode();
  
  const isCompatible = mode === expectedMode;
  
  if (!isCompatible) {
    console.warn(`[BinanceHedgeMode] Mode mismatch: expected ${expectedMode}, detected ${mode}`);
  }
  
  return isCompatible;
}

/**
 * Initialize hedge mode detection on startup (synchronous)
 * This must be called before any trading operations
 */
export async function initializeHedgeModeDetection(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    console.log('[BinanceHedgeMode] BINANCE_ENABLED is not true, skipping hedge mode detection');
    detectedMode = 'ONE_WAY'; // Default to ONE_WAY if Binance is disabled
    return;
  }

  console.log('[BinanceHedgeMode] Initializing hedge mode detection...');
  
  // Detect synchronously (no delay)
  await ensurePositionModeDetected();
  console.log(`[BinanceHedgeMode] Position mode detection complete: ${detectedMode}`);
}
