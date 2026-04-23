import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateTotalVolume,
  validateStrategicEntry,
  validateOrderLogic,
  validateEntryAlignmentWithPositions
} from '../../src/services/autoEntryLogic.js';

// Mock database functions
vi.mock('../../src/db/database.js', () => ({
  getPositions: vi.fn(),
  getPendingOrders: vi.fn()
}));

describe('autoEntryLogic - Volume Management & Order Validation', () => {
  describe('validateOrderLogic', () => {
    it('should validate LONG order with correct SL/TP placement', () => {
      const result = validateOrderLogic('long', 77000, 76500, 78000);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Order logic valid');
    });

    it('should reject LONG order with SL above entry', () => {
      const result = validateOrderLogic('long', 77000, 77500, 78000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be below entry');
    });

    it('should reject LONG order with TP below entry', () => {
      const result = validateOrderLogic('long', 77000, 76500, 76500);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be above entry');
    });

    it('should validate SHORT order with correct SL/TP placement', () => {
      const result = validateOrderLogic('short', 77000, 77500, 76500);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Order logic valid');
    });

    it('should reject SHORT order with SL below entry', () => {
      const result = validateOrderLogic('short', 77000, 76500, 76500);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be above entry');
    });

    it('should reject SHORT order with TP above entry', () => {
      const result = validateOrderLogic('short', 77000, 77500, 78000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('must be below entry');
    });

    it('should reject order with missing entry', () => {
      const result = validateOrderLogic('long', null, 76500, 78000);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Entry, SL, and TP are required');
    });

    it('should reject order with missing SL', () => {
      const result = validateOrderLogic('long', 77000, null, 78000);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Entry, SL, and TP are required');
    });

    it('should reject order with missing TP', () => {
      const result = validateOrderLogic('long', 77000, 76500, null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Entry, SL, and TP are required');
    });

    it('should reject order with invalid side', () => {
      const result = validateOrderLogic('invalid', 77000, 76500, 78000);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid side: invalid');
    });

    it('should reject order with SL too close to entry (< 0.5%)', () => {
      const result = validateOrderLogic('long', 77000, 76990, 78000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too close to entry');
      expect(result.reason).toContain('0.5%');
    });

    it('should accept order with SL at minimum 0.5% distance', () => {
      const result = validateOrderLogic('long', 77000, 76500, 78000);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateStrategicEntry', () => {
    it('should return true when no open positions exist', () => {
      const result = validateStrategicEntry(77000, []);
      expect(result).toBe(true);
    });

    it('should return true when entry aligns with SL of existing position', () => {
      const openPositions = [
        { position_id: 'pos1', stop_loss: 76500, take_profit: 78000 }
      ];
      const result = validateStrategicEntry(76525, openPositions, 0.005); // 0.5% tolerance
      expect(result).toBe(true);
    });

    it('should return true when entry aligns with TP of existing position', () => {
      const openPositions = [
        { position_id: 'pos1', stop_loss: 76500, take_profit: 78000 }
      ];
      const result = validateStrategicEntry(77975, openPositions, 0.005); // 0.5% tolerance
      expect(result).toBe(true);
    });

    it('should return false when entry does not align with SL/TP', () => {
      const openPositions = [
        { position_id: 'pos1', stop_loss: 76500, take_profit: 78000 }
      ];
      const result = validateStrategicEntry(77250, openPositions, 0.005); // Far from SL/TP
      expect(result).toBe(false);
    });

    it('should use default tolerance of 0.5% when not specified', () => {
      const openPositions = [
        { position_id: 'pos1', stop_loss: 76500, take_profit: 78000 }
      ];
      const result = validateStrategicEntry(76525, openPositions); // Default 0.5% tolerance
      expect(result).toBe(true);
    });

    it('should handle multiple positions and check against all', () => {
      const openPositions = [
        { position_id: 'pos1', stop_loss: 76500, take_profit: 78000 },
        { position_id: 'pos2', stop_loss: 76000, take_profit: 77500 }
      ];
      const result = validateStrategicEntry(77475, openPositions, 0.005); // Near pos2 TP
      expect(result).toBe(true);
    });
  });

  describe('calculateTotalVolume', () => {
    it('should calculate total volume from open positions and pending orders', async () => {
      const { getPositions, getPendingOrders } = await import('../../src/db/database.js');
      
      getPositions.mockResolvedValue([
        { size_usd: 1000 },
        { size_usd: 500 }
      ]);
      
      getPendingOrders.mockResolvedValue([
        { size_usd: 300 },
        { size_usd: 200 }
      ]);
      
      const db = {};
      const result = await calculateTotalVolume(db, 1, 'BTC');
      
      expect(result).toBe(2000); // 1000 + 500 + 300 + 200
      expect(getPositions).toHaveBeenCalledWith(db, { account_id: 1, symbol: 'BTC', status: 'open' });
      expect(getPendingOrders).toHaveBeenCalledWith(db, { account_id: 1, symbol: 'BTC', status: 'pending' });
    });

    it('should handle empty positions and orders', async () => {
      const { getPositions, getPendingOrders } = await import('../../src/db/database.js');
      
      getPositions.mockResolvedValue([]);
      getPendingOrders.mockResolvedValue([]);
      
      const db = {};
      const result = await calculateTotalVolume(db, 1, 'BTC');
      
      expect(result).toBe(0);
    });

    it('should handle positions with undefined size_usd', async () => {
      const { getPositions, getPendingOrders } = await import('../../src/db/database.js');
      
      getPositions.mockResolvedValue([
        { size_usd: 1000 },
        { size_usd: undefined },
        { size_usd: 500 }
      ]);
      
      getPendingOrders.mockResolvedValue([
        { size_usd: 300 }
      ]);
      
      const db = {};
      const result = await calculateTotalVolume(db, 1, 'BTC');
      
      expect(result).toBe(1800); // 1000 + 0 + 500 + 300
    });
  });

  describe('validateEntryAlignmentWithPositions', () => {
    it('should return true when no open positions exist', () => {
      const result = validateEntryAlignmentWithPositions(77000, 'short', []);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('No open positions to validate against');
    });

    it('should allow SHORT order with entry >= SL (above SL)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: 77500, take_profit: 76500 }
      ];
      const result = validateEntryAlignmentWithPositions(78000, 'short', openPositions);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Entry aligns with existing positions');
    });

    it('should allow SHORT order with entry <= TP (below TP)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: 77500, take_profit: 76500 }
      ];
      const result = validateEntryAlignmentWithPositions(76000, 'short', openPositions);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Entry aligns with existing positions');
    });

    it('should reject SHORT order with entry between TP and SL (invalid zone)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: 77500, take_profit: 76500 }
      ];
      const result = validateEntryAlignmentWithPositions(77000, 'short', openPositions);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('is between TP');
      expect(result.reason).toContain('and SL');
    });

    it('should allow LONG order with entry >= TP (above TP)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'long', stop_loss: 76500, take_profit: 77500 }
      ];
      const result = validateEntryAlignmentWithPositions(78000, 'long', openPositions);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Entry aligns with existing positions');
    });

    it('should allow LONG order with entry <= SL (below SL)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'long', stop_loss: 76500, take_profit: 77500 }
      ];
      const result = validateEntryAlignmentWithPositions(76000, 'long', openPositions);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Entry aligns with existing positions');
    });

    it('should reject LONG order with entry between SL and TP (invalid zone)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'long', stop_loss: 76500, take_profit: 77500 }
      ];
      const result = validateEntryAlignmentWithPositions(77000, 'long', openPositions);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('is between SL');
      expect(result.reason).toContain('and TP');
    });

    it('should allow mixed side positions (no conflict)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: 77500, take_profit: 76500 },
        { position_id: 'pos2', side: 'long', stop_loss: 76500, take_profit: 77500 }
      ];
      const result = validateEntryAlignmentWithPositions(77000, 'short', openPositions);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Entry aligns with existing positions');
    });

    it('should skip positions without SL/TP data', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: null, take_profit: 76500 }
      ];
      const result = validateEntryAlignmentWithPositions(77000, 'short', openPositions);
      expect(result.valid).toBe(true);
      expect(result.reason).toBe('Entry aligns with existing positions');
    });

    it('should handle multiple positions and check against all', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: 77500, take_profit: 76500 },
        { position_id: 'pos2', side: 'short', stop_loss: 78000, take_profit: 77000 }
      ];
      // Entry 77250 is invalid for pos2 (77000 < 77250 < 78000)
      const result = validateEntryAlignmentWithPositions(77250, 'short', openPositions);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('pos2');
    });

    it('should allow entry at exact boundary (SHORT entry = SL)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: 77500, take_profit: 76500 }
      ];
      const result = validateEntryAlignmentWithPositions(77500, 'short', openPositions);
      expect(result.valid).toBe(true);
    });

    it('should allow entry at exact boundary (SHORT entry = TP)', () => {
      const openPositions = [
        { position_id: 'pos1', side: 'short', stop_loss: 77500, take_profit: 76500 }
      ];
      const result = validateEntryAlignmentWithPositions(76500, 'short', openPositions);
      expect(result.valid).toBe(true);
    });
  });
});
