/**
 * Binance Futures Hedge Mode Detection Service
 *
 * Detects and validates the account's position mode (one-way vs hedge mode)
 * Ensures correct positionSide values are sent to avoid rejected orders
 */
export type PositionMode = 'ONE_WAY' | 'HEDGE';
export type OrderIntent = 'OPEN' | 'CLOSE';
/**
 * Ensure position mode is detected (called once at startup)
 */
export declare function ensurePositionModeDetected(): Promise<PositionMode>;
/**
 * Get the detected position mode (must be called after ensurePositionModeDetected)
 */
export declare function getPositionMode(): PositionMode;
/**
 * Resolve the correct positionSide based on side, intent, and current position
 *
 * @param side - Order side: 'BUY' or 'SELL'
 * @param intent - Order intent: 'OPEN' or 'CLOSE'
 * @param currentPosition - Current position info: { positionAmt: number, positionSide?: string }
 * @returns positionSide ('LONG' or 'SHORT') or null for ONE_WAY mode
 * @throws Error if context is missing or invalid
 */
export declare function resolvePositionSide(side: 'BUY' | 'SELL', intent: OrderIntent, currentPosition: {
    positionAmt: number;
    positionSide?: string;
} | null): string | null;
/**
 * Validate that positionSide is correctly set based on mode
 *
 * @param positionSide - positionSide value to validate
 * @throws Error if validation fails
 */
export declare function validatePositionSide(positionSide: string | null): void;
/**
 * Validate that the current mode is compatible with the expected mode
 *
 * This can be used to warn users if they're trying to use hedge mode features
 * when their account is in one-way mode
 */
export declare function validateModeCompatibility(expectedMode: PositionMode): boolean;
/**
 * Initialize hedge mode detection on startup (synchronous)
 * This must be called before any trading operations
 */
export declare function initializeHedgeModeDetection(): Promise<void>;
//# sourceMappingURL=binance-hedge-mode.d.ts.map