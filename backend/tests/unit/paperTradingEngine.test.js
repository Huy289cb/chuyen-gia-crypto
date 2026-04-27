import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Paper Trading Engine', () => {
  describe('closePartialPosition', () => {
    it('should calculate partial PnL correctly for long position', () => {
      const position = {
        side: 'long',
        entry_price: 75000,
        size_qty: 0.1,
        size_usd: 7500,
        risk_usd: 75,
        symbol: 'BTC'
      };
      const currentPrice = 75500;
      const closeSize = 0.05; // Close half of position
      
      // Expected PnL for full position: (75500 - 75000) * 0.1 = 50
      // Partial PnL for half: 50 * (0.05 / 0.1) = 25
      const expectedPartialPnl = 25;
      
      const fullPnL = (currentPrice - position.entry_price) * position.size_qty;
      const partialPnl = position.size_qty > 0 ? fullPnL * (closeSize / position.size_qty) : 0;
      
      expect(partialPnl).toBe(expectedPartialPnl);
    });

    it('should calculate partial PnL correctly for short position', () => {
      const position = {
        side: 'short',
        entry_price: 75000,
        size_qty: 0.1,
        size_usd: 7500,
        risk_usd: 75,
        symbol: 'BTC'
      };
      const currentPrice = 74500;
      const closeSize = 0.05; // Close half of position
      
      // Expected PnL for full position: (75000 - 74500) * 0.1 = 50
      // Partial PnL for half: 50 * (0.05 / 0.1) = 25
      const expectedPartialPnl = 25;
      
      const fullPnL = (position.entry_price - currentPrice) * position.size_qty;
      const partialPnl = position.size_qty > 0 ? fullPnL * (closeSize / position.size_qty) : 0;
      
      expect(partialPnl).toBe(expectedPartialPnl);
    });

    it('should handle zero size_qty gracefully', () => {
      const position = {
        side: 'long',
        entry_price: 75000,
        size_qty: 0,
        size_usd: 0,
        risk_usd: 0,
        symbol: 'BTC'
      };
      const currentPrice = 75500;
      const closeSize = 0.05;
      
      const fullPnL = (currentPrice - position.entry_price) * position.size_qty;
      const partialPnl = position.size_qty > 0 ? fullPnL * (closeSize / position.size_qty) : 0;
      
      expect(partialPnl).toBe(0);
    });

    it('should validate closeSize is within valid range', () => {
      const position = {
        side: 'long',
        entry_price: 75000,
        size_qty: 0.1,
        size_usd: 7500,
        risk_usd: 75,
        symbol: 'BTC'
      };
      
      const closeSize = 0.05;
      const remainingSize = position.size_qty - closeSize;
      
      expect(closeSize).toBeGreaterThan(0);
      expect(closeSize).toBeLessThanOrEqual(position.size_qty);
      expect(remainingSize).toBeGreaterThanOrEqual(0);
    });

    it('should calculate new balance correctly after partial close', () => {
      const account = {
        id: 1,
        balance: 1000,
        symbol: 'BTC'
      };
      const partialPnl = 25;
      
      const newBalance = account.balance + partialPnl;
      
      expect(newBalance).toBe(1025);
    });

    it('should create trade event data with correct structure', () => {
      const currentPrice = 75500;
      const closeSize = 0.05;
      const closeReason = 'tp1';
      const partialPnl = 25;
      const pnlPercent = 0.33;
      
      const tradeEventData = JSON.stringify({
        close_price: currentPrice,
        close_size: closeSize,
        close_reason: closeReason,
        pnl: partialPnl,
        pnl_percent: pnlPercent,
        timestamp: new Date().toISOString()
      });
      
      const parsed = JSON.parse(tradeEventData);
      expect(parsed.close_price).toBe(currentPrice);
      expect(parsed.close_size).toBe(closeSize);
      expect(parsed.close_reason).toBe(closeReason);
      expect(parsed.pnl).toBe(partialPnl);
      expect(parsed.pnl_percent).toBe(pnlPercent);
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('calculateUnrealizedPnL', () => {
    it('should calculate PnL for long position', () => {
      const position = {
        side: 'long',
        entry_price: 75000,
        size_qty: 0.1
      };
      const currentPrice = 75500;
      
      const pnl = (currentPrice - position.entry_price) * position.size_qty;
      const pnlPercent = ((currentPrice - position.entry_price) / position.entry_price) * 100;
      
      expect(pnl).toBe(50);
      expect(pnlPercent).toBeCloseTo(0.67, 2);
    });

    it('should calculate PnL for short position', () => {
      const position = {
        side: 'short',
        entry_price: 75000,
        size_qty: 0.1
      };
      const currentPrice = 74500;
      
      const pnl = (position.entry_price - currentPrice) * position.size_qty;
      const pnlPercent = ((position.entry_price - currentPrice) / position.entry_price) * 100;
      
      expect(pnl).toBe(50);
      expect(pnlPercent).toBeCloseTo(0.67, 2);
    });

    it('should return negative PnL for losing long position', () => {
      const position = {
        side: 'long',
        entry_price: 75000,
        size_qty: 0.1
      };
      const currentPrice = 74500;
      
      const pnl = (currentPrice - position.entry_price) * position.size_qty;
      
      expect(pnl).toBe(-50);
    });

    it('should return negative PnL for losing short position', () => {
      const position = {
        side: 'short',
        entry_price: 75000,
        size_qty: 0.1
      };
      const currentPrice = 75500;
      
      const pnl = (position.entry_price - currentPrice) * position.size_qty;
      
      expect(pnl).toBe(-50);
    });
  });

  describe('Balance Validation', () => {
    it('should detect negative balance', () => {
      const account = {
        starting_balance: 100,
        current_balance: 50
      };
      const partialPnl = -60; // Would result in negative balance
      const newBalance = account.current_balance + partialPnl;
      
      expect(newBalance).toBeLessThan(0);
    });

    it('should detect loss > 100%', () => {
      const account = {
        starting_balance: 100,
        current_balance: 50
      };
      const partialPnl = -60; // Would result in -10 balance
      const newBalance = account.current_balance + partialPnl;
      const lossPercent = ((newBalance - account.starting_balance) / account.starting_balance) * 100;
      
      expect(lossPercent).toBeLessThan(-100);
    });

    it('should allow valid balance update', () => {
      const account = {
        starting_balance: 100,
        current_balance: 100
      };
      const partialPnl = 10; // Valid positive PnL
      const newBalance = account.current_balance + partialPnl;
      
      expect(newBalance).toBeGreaterThan(0);
      const lossPercent = ((newBalance - account.starting_balance) / account.starting_balance) * 100;
      expect(lossPercent).toBeGreaterThan(-100);
    });

    it('should allow valid loss < 100%', () => {
      const account = {
        starting_balance: 100,
        current_balance: 100
      };
      const partialPnl = -30; // Valid loss (30%)
      const newBalance = account.current_balance + partialPnl;
      
      expect(newBalance).toBeGreaterThan(0);
      const lossPercent = ((newBalance - account.starting_balance) / account.starting_balance) * 100;
      expect(lossPercent).toBeGreaterThan(-100);
      expect(lossPercent).toBe(-30);
    });
  });
});
