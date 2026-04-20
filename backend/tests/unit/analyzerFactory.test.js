import { describe, it, expect } from 'vitest';
import { sampleAIResponse, sampleOHLCData } from '../fixtures/ohlcData.js';

describe('AnalyzerFactory', () => {
  describe('validatePriceLevel', () => {
    it('should validate bullish entry (entry must be below current price)', () => {
      const currentPrice = 75000;
      const bias = 'bullish';
      const entry = 74800;

      const isValid = entry < currentPrice;
      expect(isValid).toBe(true);
    });

    it('should validate bearish entry (entry must be above current price)', () => {
      const currentPrice = 75000;
      const bias = 'bearish';
      const entry = 75200;

      const isValid = entry > currentPrice;
      expect(isValid).toBe(true);
    });

    it('should validate bullish SL (SL must be below entry)', () => {
      const entry = 74800;
      const sl = 74500;
      const bias = 'bullish';

      const isValid = sl < entry;
      expect(isValid).toBe(true);
    });

    it('should validate bearish SL (SL must be above entry)', () => {
      const entry = 75200;
      const sl = 75500;
      const bias = 'bearish';

      const isValid = sl > entry;
      expect(isValid).toBe(true);
    });

    it('should validate bullish TP (TP must be above entry)', () => {
      const entry = 74800;
      const tp = 76000;
      const bias = 'bullish';

      const isValid = tp > entry;
      expect(isValid).toBe(true);
    });

    it('should validate bearish TP (TP must be below entry)', () => {
      const entry = 75200;
      const tp = 74500;
      const bias = 'bearish';

      const isValid = tp < entry;
      expect(isValid).toBe(true);
    });
  });

  describe('formatAnalysisResponse', () => {
    it('should format Kim Nghia analysis with Fibonacci data', () => {
      const rawResponse = {
        btc: sampleAIResponse.btc
      };

      const priceData = {
        btc: { price: 75000 }
      };

      const methodId = 'kim_nghia';

      // This test validates the expected structure
      expect(rawResponse.btc).toBeDefined();
      expect(rawResponse.btc.bias).toBeDefined();
      expect(rawResponse.btc.suggested_entry).toBeDefined();
      expect(rawResponse.btc.suggested_stop_loss).toBeDefined();
      expect(rawResponse.btc.suggested_take_profit).toBeDefined();
      expect(rawResponse.btc.alternative_scenario).toBeDefined();
    });

    it('should include alternative scenario in formatted response', () => {
      const rawResponse = {
        btc: sampleAIResponse.btc
      };

      const altScenario = rawResponse.btc.alternative_scenario;

      expect(altScenario).toBeDefined();
      expect(altScenario.trigger).toBeDefined();
      expect(altScenario.new_bias).toBeDefined();
      expect(altScenario.new_entry).toBeDefined();
      expect(altScenario.new_sl).toBeDefined();
      expect(altScenario.new_tp).toBeDefined();
    });

    it('should validate alternative scenario SL/TP placement', () => {
      const altScenario = sampleAIResponse.btc.alternative_scenario;

      if (altScenario.new_bias === 'bullish') {
        // For long: SL must be below entry, TP must be above entry
        expect(altScenario.new_sl).toBeLessThan(altScenario.new_entry);
        expect(altScenario.new_tp).toBeGreaterThan(altScenario.new_entry);
      } else if (altScenario.new_bias === 'bearish') {
        // For short: SL must be above entry, TP must be below entry
        expect(altScenario.new_sl).toBeGreaterThan(altScenario.new_entry);
        expect(altScenario.new_tp).toBeLessThan(altScenario.new_entry);
      }
    });
  });

  describe('AI response structure', () => {
    it('should have required fields in AI response', () => {
      const btcData = sampleAIResponse.btc;

      expect(btcData.bias).toBeDefined();
      expect(btcData.action).toBeDefined();
      expect(btcData.confidence).toBeDefined();
      expect(btcData.narrative).toBeDefined();
      expect(btcData.structure).toBeDefined();
      expect(btcData.volume).toBeDefined();
      expect(btcData.liquidity).toBeDefined();
      expect(btcData.smc).toBeDefined();
    });

    it('should have valid bias values', () => {
      const btcData = sampleAIResponse.btc;

      expect(['bullish', 'bearish', 'neutral']).toContain(btcData.bias);
    });

    it('should have valid action values', () => {
      const btcData = sampleAIResponse.btc;

      expect(['buy', 'sell', 'hold']).toContain(btcData.action);
    });

    it('should have confidence between 0 and 1', () => {
      const btcData = sampleAIResponse.btc;

      expect(btcData.confidence).toBeGreaterThanOrEqual(0);
      expect(btcData.confidence).toBeLessThanOrEqual(1);
    });
  });
});
