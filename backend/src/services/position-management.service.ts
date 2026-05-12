/**
 * Position Management Service
 * Simplified position management with HOLD / REDUCE / EXIT actions
 * Removes aggressive reverse behavior unless new setup is confirmed
 */

import { prisma } from '../lib/prisma';
import { analyzePositionHealth, PositionData } from '../analyzers/position-health.analyzer';

export interface PositionAction {
  position_id: string;
  action: 'hold' | 'reduce' | 'exit' | 'reverse';
  reason: string;
  reduce_percent?: number; // 0-1 for reduce action
  new_sl?: number; // for reverse or reduce
  new_tp?: number; // for reverse or reduce
}

/**
 * Position Management Service
 */
export class PositionManagementService {
  /**
   * Evaluate all open positions and determine actions
   */
  async evaluatePositions(): Promise<PositionAction[]> {
    const actions: PositionAction[] = [];

    try {
      // Get open testnet positions
      const openPositions = await prisma.testnetPosition.findMany({
        where: { status: 'open' }
      });

      for (const position of openPositions) {
        const positionData: PositionData = {
          position_id: position.position_id,
          symbol: position.symbol,
          side: position.side as 'long' | 'short',
          entry_price: position.entry_price,
          current_price: position.current_price,
          stop_loss: position.stop_loss,
          take_profit: position.take_profit,
          entry_time: position.entry_time,
          size_qty: position.size_qty,
          unrealized_pnl: position.unrealized_pnl
        };

        const health = analyzePositionHealth(positionData);

        const action: PositionAction = {
          position_id: position.position_id,
          action: health.recommended_action,
          reason: health.reason
        };

        // Add reduce percent if reducing
        if (health.recommended_action === 'reduce') {
          action.reduce_percent = 0.5; // Reduce by 50% by default
        }

        actions.push(action);
      }
    } catch (error) {
      console.error('[PositionManagement] Error evaluating positions:', error);
    }

    return actions;
  }

  /**
   * Execute position action (will be implemented in integration phase)
   */
  async executeAction(action: PositionAction): Promise<boolean> {
    console.log(`[PositionManagement] Executing action: ${action.action} for position ${action.position_id}`);
    console.log(`[PositionManagement] Reason: ${action.reason}`);

    // This will be implemented in integration phase with actual Binance API calls
    // For now, just log the action
    return true;
  }

  /**
   * Execute reverse position action
   * Only called when new valid setup exists
   */
  async executeReverse(
    positionId: string,
    newSide: 'long' | 'short',
    newEntry: number,
    newSl: number,
    newTp: number
  ): Promise<boolean> {
    console.log(`[PositionManagement] Executing REVERSE for position ${positionId}`);
    console.log(`[PositionManagement] New side: ${newSide}, Entry: ${newEntry}, SL: ${newSl}, TP: ${newTp}`);

    // This will be implemented in integration phase
    // 1. Close existing position
    // 2. Open new position in opposite direction
    return true;
  }

  /**
   * Check if position should be managed based on market conditions
   * Only manage when:
   * - Position is in profit OR
   * - Market structure changed
   */
  async shouldManagePosition(positionId: string, marketStructureChanged: boolean): Promise<boolean> {
    try {
      const position = await prisma.testnetPosition.findUnique({
        where: { position_id: positionId }
      });

      if (!position) return false;

      // Manage if in profit
      if (position.unrealized_pnl > 0) {
        return true;
      }

      // Manage if market structure changed
      if (marketStructureChanged) {
        return true;
      }

      return false;
    } catch (error) {
      console.error('[PositionManagement] Error checking if should manage:', error);
      return false;
    }
  }

  /**
   * Apply stale trade exit logic
   */
  async checkStaleTrade(positionId: string, maxTimeMinutes: number = 240): Promise<boolean> {
    try {
      const position = await prisma.testnetPosition.findUnique({
        where: { position_id: positionId }
      });

      if (!position) return false;

      const entryTime = new Date(position.entry_time);
      const now = new Date();
      const timeInMinutes = (now.getTime() - entryTime.getTime()) / (1000 * 60);

      // Exit if position is stale (no movement for extended time)
      if (timeInMinutes > maxTimeMinutes && Math.abs(position.unrealized_pnl) < 0.1) {
        console.log(`[PositionManagement] Position ${positionId} is stale (${timeInMinutes.toFixed(0)}min, PnL: ${position.unrealized_pnl.toFixed(2)})`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[PositionManagement] Error checking stale trade:', error);
      return false;
    }
  }

  /**
   * Apply invalidation-based exit logic
   */
  async checkInvalidation(positionId: string, currentPrice: number): Promise<boolean> {
    try {
      const position = await prisma.testnetPosition.findUnique({
        where: { position_id: positionId }
      });

      if (!position) return false;

      // Check if invalidation_level exists (it's on Position model but may not be on TestnetPosition yet)
      const invalidationLevel = (position as any).invalidation_level;
      if (!invalidationLevel) return false;

      // Check if price hit invalidation level
      if (position.side === 'long' && currentPrice <= invalidationLevel) {
        console.log(`[PositionManagement] Position ${positionId} invalidated at ${currentPrice} (level: ${invalidationLevel})`);
        return true;
      }

      if (position.side === 'short' && currentPrice >= invalidationLevel) {
        console.log(`[PositionManagement] Position ${positionId} invalidated at ${currentPrice} (level: ${invalidationLevel})`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[PositionManagement] Error checking invalidation:', error);
      return false;
    }
  }
}

// Export singleton instance
export const positionManagementService = new PositionManagementService();
