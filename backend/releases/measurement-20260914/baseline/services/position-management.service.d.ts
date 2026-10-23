/**
 * Position Management Service
 * Simplified position management with HOLD / REDUCE / EXIT actions
 * Removes aggressive reverse behavior unless new setup is confirmed
 */
export interface PositionAction {
    position_id: string;
    action: 'hold' | 'reduce' | 'exit' | 'reverse';
    reason: string;
    reduce_percent?: number;
    new_sl?: number;
    new_tp?: number;
}
/**
 * Position Management Service
 */
export declare class PositionManagementService {
    /**
     * Evaluate all open positions and determine actions
     */
    evaluatePositions(): Promise<PositionAction[]>;
    /**
     * Execute position action (will be implemented in integration phase)
     */
    executeAction(action: PositionAction): Promise<boolean>;
    /**
     * Execute reverse position action
     * Only called when new valid setup exists
     */
    executeReverse(positionId: string, newSide: 'long' | 'short', newEntry: number, newSl: number, newTp: number): Promise<boolean>;
    /**
     * Check if position should be managed based on market conditions
     * Only manage when:
     * - Position is in profit OR
     * - Market structure changed
     */
    shouldManagePosition(positionId: string, marketStructureChanged: boolean): Promise<boolean>;
    /**
     * Apply stale trade exit logic
     */
    checkStaleTrade(positionId: string, maxTimeMinutes?: number): Promise<boolean>;
    /**
     * Apply invalidation-based exit logic
     */
    checkInvalidation(positionId: string, currentPrice: number): Promise<boolean>;
}
export declare const positionManagementService: PositionManagementService;
//# sourceMappingURL=position-management.service.d.ts.map