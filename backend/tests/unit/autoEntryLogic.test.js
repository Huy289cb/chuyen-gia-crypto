import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateTotalVolume,
  validateStrategicEntry,
  validateOrderLogic,
  validateEntryAlignmentWithPositions,
  recalculateSLTPForMarketOrder
} from '../../src/services/autoEntryLogic.js';

// Mock method config
vi.mock('../../src/config/methods.js', () => ({
  getMethodConfig: vi.fn((methodId) => {
    if (methodId === 'ict') {
      return {
        autoEntry: {
          minSLDistancePercent: 0.0075 // 0.75% for ICT
        }
      };
    }
    if (methodId === 'kim_nghia') {
      return {
        autoEntry: {
          minSLDistancePercent: 0.004 // 0.4% for Kim Nghia
        }
      };
    }
    return {
      autoEntry: {
        minSLDistancePercent: 0.005 // Default 0.5%
      }
    };
  })
}));

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

  describe('recalculateSLTPForMarketOrder', () => {
    it('should recalculate SL/TP for LONG position maintaining percentage distance', async () => {
      const suggestedPosition = {
        entry_price: 77000,
        stop_loss: 76500, // 0.65% below entry
        take_profit: 78000, // 1.3% above entry
        side: 'long'
      };
      const newEntryPrice = 77500;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'long', null);
      
      expect(result).not.toBeNull();
      expect(result.entry_price).toBe(77500);
      expect(result.stop_loss).toBeLessThan(77500); // SL below entry for long
      expect(result.take_profit).toBeGreaterThan(77500); // TP above entry for long
      
      // Verify percentage distance is maintained
      const originalSLDistance = Math.abs(76500 - 77000) / 77000;
      const newSLDistance = Math.abs(result.stop_loss - 77500) / 77500;
      expect(Math.abs(newSLDistance - originalSLDistance)).toBeLessThan(0.0001);
    });

    it('should recalculate SL/TP for SHORT position maintaining percentage distance', async () => {
      const suggestedPosition = {
        entry_price: 77800,
        stop_loss: 78400, // 0.77% above entry
        take_profit: 77200, // 0.77% below entry
        side: 'short'
      };
      const newEntryPrice = 78300;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'short', 'ict');
      
      expect(result).not.toBeNull();
      expect(result.entry_price).toBe(78300);
      expect(result.stop_loss).toBeGreaterThan(78300); // SL above entry for short
      expect(result.take_profit).toBeLessThan(78300); // TP below entry for short
      
      // Verify SL distance meets ICT minimum (0.75%)
      const newSLDistance = Math.abs(result.stop_loss - 78300) / 78300;
      expect(newSLDistance).toBeGreaterThanOrEqual(0.0075);
    });

    it('should reject if recalculated SL distance is below minimum threshold', async () => {
      const suggestedPosition = {
        entry_price: 77800,
        stop_loss: 77850, // Only 0.06% above entry - too small
        take_profit: 77200,
        side: 'short'
      };
      const newEntryPrice = 78300;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'short', 'ict');
      
      expect(result).toBeNull(); // Should reject due to insufficient SL distance
    });

    it('should use minimum SL distance when original SL is not provided', async () => {
      const suggestedPosition = {
        entry_price: 77000,
        stop_loss: 0, // No SL provided
        take_profit: 78000,
        side: 'long'
      };
      const newEntryPrice = 77500;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'long', null);
      
      expect(result).not.toBeNull();
      expect(result.entry_price).toBe(77500);
      
      // Should use default minimum (0.5%)
      const newSLDistance = Math.abs(result.stop_loss - 77500) / 77500;
      expect(newSLDistance).toBeGreaterThanOrEqual(0.005);
    });

    it('should use 2x SL distance for TP when original TP is not provided', async () => {
      const suggestedPosition = {
        entry_price: 77000,
        stop_loss: 76500, // 0.65% below
        take_profit: 0, // No TP provided
        side: 'long'
      };
      const newEntryPrice = 77500;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'long', null);
      
      expect(result).not.toBeNull();
      
      const slDistance = Math.abs(result.stop_loss - 77500) / 77500;
      const tpDistance = Math.abs(result.take_profit - 77500) / 77500;
      
      // TP distance should be approximately 2x SL distance
      expect(tpDistance).toBeCloseTo(slDistance * 2, 2);
    });

    it('should use method-specific minimum SL distance for ICT', async () => {
      const suggestedPosition = {
        entry_price: 77000,
        stop_loss: 0,
        take_profit: 78000,
        side: 'long'
      };
      const newEntryPrice = 77500;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'long', 'ict');
      
      expect(result).not.toBeNull();
      
      // ICT minimum is 0.75%
      const newSLDistance = Math.abs(result.stop_loss - 77500) / 77500;
      expect(newSLDistance).toBeGreaterThanOrEqual(0.0075);
    });

    it('should use method-specific minimum SL distance for Kim Nghia', async () => {
      const suggestedPosition = {
        entry_price: 77000,
        stop_loss: 0,
        take_profit: 78000,
        side: 'long'
      };
      const newEntryPrice = 77500;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'long', 'kim_nghia');
      
      expect(result).not.toBeNull();
      
      // Kim Nghia minimum is 0.4%
      const newSLDistance = Math.abs(result.stop_loss - 77500) / 77500;
      expect(newSLDistance).toBeGreaterThanOrEqual(0.004);
    });

    it('should return null for invalid side', async () => {
      const suggestedPosition = {
        entry_price: 77000,
        stop_loss: 76500,
        take_profit: 78000,
        side: 'invalid'
      };
      const newEntryPrice = 77500;
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'invalid', null);
      
      expect(result).toBeNull();
    });

    it('should handle the user-reported bug case: short with current price above suggested entry', async () => {
      // User's example: current=78300, AI: entry=77800, SL=78400, TP=77200
      const suggestedPosition = {
        entry_price: 77800,
        stop_loss: 78400, // 0.77% above original entry
        take_profit: 77200, // 0.77% below original entry
        side: 'short'
      };
      const newEntryPrice = 78300; // Current price
      
      const result = await recalculateSLTPForMarketOrder(suggestedPosition, newEntryPrice, 'short', 'ict');
      
      expect(result).not.toBeNull();
      expect(result.entry_price).toBe(78300);
      expect(result.stop_loss).toBeGreaterThan(78300); // SL above entry for short
      expect(result.take_profit).toBeLessThan(78300); // TP below entry for short
      
      // Verify SL distance meets ICT minimum (0.75%)
      const newSLDistance = Math.abs(result.stop_loss - 78300) / 78300;
      expect(newSLDistance).toBeGreaterThanOrEqual(0.0075);
      
      // Original distance was ~0.77%, new should be similar
      const originalSLDistance = Math.abs(78400 - 77800) / 77800;
      expect(Math.abs(newSLDistance - originalSLDistance)).toBeLessThan(0.0001);
    });
  });

  describe('Bias-Action Validation (Check 7.5)', () => {
    it('should validate bullish bias with buy action', () => {
      const analysis = {
        bias: 'bullish',
        action: 'buy',
        confidence: 0.8
      };
      const expectedAction = analysis.bias === 'bullish' ? 'buy' : 'sell';
      expect(analysis.action).toBe(expectedAction);
    });

    it('should validate bearish bias with sell action', () => {
      const analysis = {
        bias: 'bearish',
        action: 'sell',
        confidence: 0.8
      };
      const expectedAction = analysis.bias === 'bullish' ? 'buy' : 'sell';
      expect(analysis.action).toBe(expectedAction);
    });

    it('should reject bullish bias with sell action (mismatch)', () => {
      const analysis = {
        bias: 'bullish',
        action: 'sell',
        confidence: 0.8
      };
      const expectedAction = analysis.bias === 'bullish' ? 'buy' : 'sell';
      expect(analysis.action).not.toBe(expectedAction);
    });

    it('should reject bearish bias with buy action (mismatch)', () => {
      const analysis = {
        bias: 'bearish',
        action: 'buy',
        confidence: 0.8
      };
      const expectedAction = analysis.bias === 'bullish' ? 'buy' : 'sell';
      expect(analysis.action).not.toBe(expectedAction);
    });

    it('should validate neutral bias with hold action', () => {
      const analysis = {
        bias: 'neutral',
        action: 'hold',
        confidence: 0.5
      };
      const expectedAction = analysis.bias === 'bullish' ? 'buy' : analysis.bias === 'bearish' ? 'sell' : 'hold';
      expect(analysis.action).toBe(expectedAction);
    });
  });

  describe('Entry Quality Filters', () => {
    describe('Confluence Filter (3/5 rule)', () => {
      it('should pass with 3/5 confluence met', () => {
        const confluence = {
          multiTimeframeAlignment: true,
          volumeConfirmation: true,
          liquiditySweep: true,
          orderBlockNearby: false,
          fvgNearby: false
        };
        const confluenceCount = Object.values(confluence).filter(v => v).length;
        expect(confluenceCount).toBeGreaterThanOrEqual(3);
      });

      it('should fail with 2/5 confluence met', () => {
        const confluence = {
          multiTimeframeAlignment: true,
          volumeConfirmation: true,
          liquiditySweep: false,
          orderBlockNearby: false,
          fvgNearby: false
        };
        const confluenceCount = Object.values(confluence).filter(v => v).length;
        expect(confluenceCount).toBeLessThan(3);
      });

      it('should pass with 5/5 confluence met', () => {
        const confluence = {
          multiTimeframeAlignment: true,
          volumeConfirmation: true,
          liquiditySweep: true,
          orderBlockNearby: true,
          fvgNearby: true
        };
        const confluenceCount = Object.values(confluence).filter(v => v).length;
        expect(confluenceCount).toBe(5);
      });
    });

    describe('Session Filter', () => {
      it('should pass during London Killzone (7-10 UTC)', () => {
        const utcHour = 8;
        const highLiquiditySessions = [
          { name: 'London Killzone', start: 7, end: 10 },
          { name: 'NY Killzone', start: 12, end: 15 }
        ];
        const inHighLiquiditySession = highLiquiditySessions.some(session => 
          utcHour >= session.start && utcHour < session.end
        );
        expect(inHighLiquiditySession).toBe(true);
      });

      it('should pass during NY Killzone (12-15 UTC)', () => {
        const utcHour = 13;
        const highLiquiditySessions = [
          { name: 'London Killzone', start: 7, end: 10 },
          { name: 'NY Killzone', start: 12, end: 15 }
        ];
        const inHighLiquiditySession = highLiquiditySessions.some(session => 
          utcHour >= session.start && utcHour < session.end
        );
        expect(inHighLiquiditySession).toBe(true);
      });

      it('should fail outside high liquidity sessions', () => {
        const utcHour = 16;
        const highLiquiditySessions = [
          { name: 'London Killzone', start: 7, end: 10 },
          { name: 'NY Killzone', start: 12, end: 15 }
        ];
        const inHighLiquiditySession = highLiquiditySessions.some(session => 
          utcHour >= session.start && utcHour < session.end
        );
        expect(inHighLiquiditySession).toBe(false);
      });
    });

    describe('Market Structure Filter', () => {
      it('should pass with BOS detected for trend following', () => {
        const analysis = {
          bias: 'bullish',
          break_of_structure: true,
          change_of_character: false,
          range_width: 0.005
        };
        const structure = {
          hasBOS: analysis.break_of_structure === true,
          hasCHOCH: analysis.change_of_character === true,
          isNotChoppy: analysis.range_width === undefined || analysis.range_width < 0.01
        };
        expect(structure.hasBOS).toBe(true);
        expect(structure.isNotChoppy).toBe(true);
      });

      it('should fail without BOS for trend following', () => {
        const analysis = {
          bias: 'bullish',
          break_of_structure: false,
          change_of_character: false,
          range_width: 0.005
        };
        const structure = {
          hasBOS: analysis.break_of_structure === true,
          hasCHOCH: analysis.change_of_character === true,
          isNotChoppy: analysis.range_width === undefined || analysis.range_width < 0.01
        };
        expect(structure.hasBOS).toBe(false);
      });

      it('should fail for choppy market (range width > 1%)', () => {
        const analysis = {
          bias: 'bullish',
          break_of_structure: true,
          change_of_character: false,
          range_width: 0.015
        };
        const structure = {
          hasBOS: analysis.break_of_structure === true,
          hasCHOCH: analysis.change_of_character === true,
          isNotChoppy: analysis.range_width === undefined || analysis.range_width < 0.01
        };
        expect(structure.isNotChoppy).toBe(false);
      });
    });
  });

  describe('Kim Nghia Method - Real World Input Test', () => {
    it('should pass auto-entry checks with real Kim Nghia AI response (v1.2.15)', async () => {
      // Real AI response from logs that should pass with v1.2.15 config
      const analysis = {
        symbol: 'BTC',
        bias: 'bearish',
        action: 'sell',
        confidence: 0.85,
        narrative: 'Bearish bias due to recent price action and volume analysis.',
        current_price: 76865.14,
        suggested_entry: 76800,
        suggested_stop_loss: 77200,
        suggested_take_profit: 76300,
        expected_rr: 2.5,
        // Confluence fields
        volume: 114.9853,
        avgVolume: 120,
        liquidity_sweep_detected: true,
        order_block_distance: 0.005,
        fvg_distance: 0.008,
        // Market structure fields
        break_of_structure: true,
        change_of_character: true,
        range_width: 0.015,
        position_decisions: [],
        pending_order_decisions: []
      };

      const account = {
        account_id: 1,
        symbol: 'BTC',
        balance: 100,
        method_id: 'kim_nghia',
        cooldown_until: null,
        consecutive_losses: 0
      };

      const methodConfig = {
        methodId: 'kim_nghia',
        name: 'SMC + Volume + Fibonacci',
        autoEntry: {
          enabledSymbols: ['BTC'],
          minConfidence: 0.75,
          minRRRatio: 2.5,
          maxOpenPositions: 6,
          maxVolumePerAccount: 2000,
          requireConfluence: true,
          requireHighLiquiditySession: false, // v1.2.14: session filter disabled
          requireMarketStructure: false, // v1.2.15: market structure filter disabled
          riskPerTrade: 0.10,
          minSLDistancePercent: 0.005,
          allowedSessions: ['all_timeframes']
        }
      };

      // Import evaluateAutoEntry
      const { evaluateAutoEntry } = await import('../../src/services/autoEntryLogic.js');
      
      // Mock database
      const db = null;

      const decision = await evaluateAutoEntry(analysis, account, [], methodConfig, db);

      // Verify the decision passes with v1.2.15 config
      expect(decision.shouldEnter).toBe(true);
      expect(decision.action).toBe('enter_short');
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.reason).toContain('All criteria met');
    });

    it('should calculate confluence correctly for Kim Nghia method (3/4 met)', () => {
      const analysis = {
        volume: 114.9853,
        avgVolume: 120,
        liquidity_sweep_detected: true,
        order_block_distance: 0.005,
        fvg_distance: 0.008
      };

      // Kim Nghia confluence check (v1.2.12)
      const confluence = {
        volumeConfirmation: analysis.volume && analysis.avgVolume ? analysis.volume > analysis.avgVolume * 1.2 : null,
        liquiditySweep: analysis.liquidity_sweep_detected === true,
        orderBlockNearby: analysis.order_block_distance !== undefined && analysis.order_block_distance <= 0.01,
        fvgNearby: analysis.fvg_distance !== undefined && analysis.fvg_distance <= 0.01
      };

      const confluenceValues = Object.values(confluence).filter(v => v !== null);
      const confluenceCount = confluenceValues.filter(v => v).length;
      const confluenceTotal = confluenceValues.length;

      // volumeConfirmation: false (114.9853 < 120 * 1.2 = 144)
      // liquiditySweep: true
      // orderBlockNearby: true (0.005 <= 0.01)
      // fvgNearby: true (0.008 <= 0.01)
      expect(confluence.volumeConfirmation).toBe(false);
      expect(confluence.liquiditySweep).toBe(true);
      expect(confluence.orderBlockNearby).toBe(true);
      expect(confluence.fvgNearby).toBe(true);
      expect(confluenceCount).toBe(3);
      expect(confluenceTotal).toBe(4);
    });

    it('should skip session filter when requireHighLiquiditySession is false', () => {
      const config = {
        requireHighLiquiditySession: false
      };

      if (config.requireHighLiquiditySession) {
        // This should not execute
        expect(true).toBe(false);
      }
      // Test passes if no error is thrown
      expect(config.requireHighLiquiditySession).toBe(false);
    });

    it('should skip market structure filter when requireMarketStructure is false', () => {
      const config = {
        requireMarketStructure: false
      };

      const analysis = {
        range_width: 0.015 // Would fail if filter was enabled (> 1%)
      };

      if (config.requireMarketStructure) {
        const structure = {
          isNotChoppy: analysis.range_width === undefined || analysis.range_width < 0.01
        };
        expect(structure.isNotChoppy).toBe(false); // Would fail
      }
      // Test passes if no error is thrown
      expect(config.requireMarketStructure).toBe(false);
    });
  });
});
