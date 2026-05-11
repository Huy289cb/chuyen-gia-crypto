/**
 * Binance Futures Hedge Mode Detection Service
 * 
 * Detects and validates the account's position mode (one-way vs hedge mode)
 * Ensures correct positionSide values are sent to avoid rejected orders
 */

import { getPositionRisk } from './binanceClient';

export type PositionMode = 'ONE_WAY' | 'HEDGE';

let detectedMode: PositionMode | null = null;

/**
 * Detect the account's position mode from Binance
 * 
 * Returns 'ONE_WAY' or 'HEDGE' based on the account's current mode
 */
export async function detectPositionMode(): Promise<PositionMode> {
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
 * Get the detected position mode
 */
export function getPositionMode(): PositionMode | null {
  return detectedMode;
}

/**
 * Get the correct positionSide for a given side based on the detected mode
 * 
 * In HEDGE mode: 'long' -> 'LONG', 'short' -> 'SHORT'
 * In ONE_WAY mode: returns null (positionSide should not be sent)
 */
export function getPositionSide(side: string): string | null {
  if (detectedMode === 'HEDGE') {
    return side === 'long' ? 'LONG' : 'SHORT';
  }
  
  // In ONE_WAY mode, don't send positionSide
  return null;
}

/**
 * Validate that the current mode is compatible with the expected mode
 * 
 * This can be used to warn users if they're trying to use hedge mode features
 * when their account is in one-way mode
 */
export function validateModeCompatibility(expectedMode: PositionMode): boolean {
  if (!detectedMode) {
    console.warn('[BinanceHedgeMode] Mode not yet detected, cannot validate');
    return false;
  }
  
  const isCompatible = detectedMode === expectedMode;
  
  if (!isCompatible) {
    console.warn(`[BinanceHedgeMode] Mode mismatch: expected ${expectedMode}, detected ${detectedMode}`);
  }
  
  return isCompatible;
}

/**
 * Initialize hedge mode detection on startup
 */
export async function initializeHedgeModeDetection(): Promise<void> {
  if (process.env.BINANCE_ENABLED !== 'true') {
    console.log('[BinanceHedgeMode] BINANCE_ENABLED is not true, skipping hedge mode detection');
    return;
  }

  console.log('[BinanceHedgeMode] Initializing hedge mode detection...');
  
  // Wait a bit for the backend to fully start
  setTimeout(async () => {
    await detectPositionMode();
  }, 3000); // 3 seconds delay
}
