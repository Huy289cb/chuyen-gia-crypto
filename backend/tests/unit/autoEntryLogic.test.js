import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateTotalVolume,
  validateStrategicEntry,
  validateOrderLogic
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
});
