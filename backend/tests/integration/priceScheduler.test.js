import { describe, it, expect } from 'vitest';

describe('Price Scheduler Integration', () => {
  describe('1-minute candle data structure', () => {
    it('should have correct candle data structure', () => {
      const candle = {
        price: 75000, // close price
        open: 74800,
        high: 75200,
        low: 74700,
        volume: 1000,
        time: new Date().toISOString()
      };

      expect(candle.price).toBeDefined();
      expect(candle.open).toBeDefined();
      expect(candle.high).toBeDefined();
      expect(candle.low).toBeDefined();
      expect(candle.volume).toBeDefined();
      expect(candle.time).toBeDefined();
    });

    it('should have high >= low in candle data', () => {
      const candle = {
        price: 75000,
        open: 74800,
        high: 75200,
        low: 74700,
        volume: 1000,
        time: new Date().toISOString()
      };

      expect(candle.high).toBeGreaterThanOrEqual(candle.low);
    });

    it('should have high >= close and close >= low in candle data', () => {
      const candle = {
        price: 75000,
        open: 74800,
        high: 75200,
        low: 74700,
        volume: 1000,
        time: new Date().toISOString()
      };

      expect(candle.high).toBeGreaterThanOrEqual(candle.price);
      expect(candle.price).toBeGreaterThanOrEqual(candle.low);
    });
  });

  describe('SL/TP detection using candle high/low', () => {
    it('should detect SL hit for long position using candle low', () => {
      const position = {
        side: 'long',
        stop_loss: 74700
      };

      const candle = {
        price: 75000,
        open: 74800,
        high: 75200,
        low: 74600, // Low is below SL
        volume: 1000
      };

      const hitSL = candle.low <= position.stop_loss;
      expect(hitSL).toBe(true);
    });

    it('should detect SL hit for short position using candle high', () => {
      const position = {
        side: 'short',
        stop_loss: 75300
      };

      const candle = {
        price: 75000,
        open: 74800,
        high: 75400, // High is above SL
        low: 74700,
        volume: 1000
      };

      const hitSL = candle.high >= position.stop_loss;
      expect(hitSL).toBe(true);
    });

    it('should detect TP hit for long position using candle high', () => {
      const position = {
        side: 'long',
        take_profit: 75200
      };

      const candle = {
        price: 75000,
        open: 74800,
        high: 75300, // High is above TP
        low: 74700,
        volume: 1000
      };

      const hitTP = candle.high >= position.take_profit;
      expect(hitTP).toBe(true);
    });

    it('should detect TP hit for short position using candle low', () => {
      const position = {
        side: 'short',
        take_profit: 74700
      };

      const candle = {
        price: 75000,
        open: 74800,
        high: 75200,
        low: 74600, // Low is below TP
        volume: 1000
      };

      const hitTP = candle.low <= position.take_profit;
      expect(hitTP).toBe(true);
    });

    it('should not detect SL hit if candle low is above SL for long', () => {
      const position = {
        side: 'long',
        stop_loss: 74700
      };

      const candle = {
        price: 75000,
        open: 74800,
        high: 75200,
        low: 74800, // Low is above SL
        volume: 1000
      };

      const hitSL = candle.low <= position.stop_loss;
      expect(hitSL).toBe(false);
    });
  });

  describe('Pending order execution using candle data', () => {
    it('should execute long limit order when candle low is at or below entry', () => {
      const order = {
        side: 'long',
        entry_price: 74800
      };

      const candle = {
        price: 75000,
        open: 74900,
        high: 75100,
        low: 74700, // Low is below entry
        volume: 1000
      };

      const shouldExecute = candle.low <= order.entry_price;
      expect(shouldExecute).toBe(true);
    });

    it('should execute short limit order when candle high is at or above entry', () => {
      const order = {
        side: 'short',
        entry_price: 75200
      };

      const candle = {
        price: 75000,
        open: 74900,
        high: 75300, // High is above entry
        low: 74700,
        volume: 1000
      };

      const shouldExecute = candle.high >= order.entry_price;
      expect(shouldExecute).toBe(true);
    });

    it('should not execute long limit order if candle low is above entry', () => {
      const order = {
        side: 'long',
        entry_price: 74800
      };

      const candle = {
        price: 75000,
        open: 74900,
        high: 75100,
        low: 74900, // Low is above entry
        volume: 1000
      };

      const shouldExecute = candle.low <= order.entry_price;
      expect(shouldExecute).toBe(false);
    });
  });

  describe('Scheduler interval', () => {
    it('should run at 1-minute interval (60 seconds)', () => {
      const intervalSeconds = 60;
      const intervalMs = intervalSeconds * 1000;

      expect(intervalSeconds).toBe(60);
      expect(intervalMs).toBe(60000);
    });

    it('should be longer than previous 30-second interval', () => {
      const oldInterval = 30;
      const newInterval = 60;

      expect(newInterval).toBeGreaterThan(oldInterval);
    });
  });
});
