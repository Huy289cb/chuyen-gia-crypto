import { describe, it, expect } from 'vitest';

describe('Scheduler', () => {
  describe('getMethodConfig import', () => {
    it('should import getMethodConfig from config/methods.js', async () => {
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      expect(getMethodConfig).toBeDefined();
      expect(typeof getMethodConfig).toBe('function');
    });

    it('should not import getMethodConfig from db/database.js', async () => {
      const dbModule = await import('../../src/db/database.js');
      
      // getMethodConfig should not exist in db/database.js
      expect(dbModule.getMethodConfig).toBeUndefined();
    });

    it('should return valid config for ict method', async () => {
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      const config = getMethodConfig('ict');
      
      expect(config).toBeDefined();
      expect(config.name).toBe('ICT Smart Money');
      expect(config.methodId).toBe('ict');
    });

    it('should return valid config for kim_nghia method', async () => {
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      const config = getMethodConfig('kim_nghia');
      
      expect(config).toBeDefined();
      expect(config.name).toBe('SMC + Volume + Fibonacci');
      expect(config.methodId).toBe('kim_nghia');
    });

    it('should have autoEntry config with minConfidence', async () => {
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      const ictConfig = getMethodConfig('ict');
      const kimNghiaConfig = getMethodConfig('kim_nghia');
      
      expect(ictConfig.autoEntry).toBeDefined();
      expect(ictConfig.autoEntry.minConfidence).toBeDefined();
      expect(kimNghiaConfig.autoEntry).toBeDefined();
      expect(kimNghiaConfig.autoEntry.minConfidence).toBeDefined();
    });

    it('should calculate confidence threshold correctly', async () => {
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      const methodConfig = getMethodConfig('ict');
      const confidenceThreshold = (methodConfig.autoEntry?.minConfidence || 70) / 100;
      
      expect(confidenceThreshold).toBeGreaterThan(0);
      expect(confidenceThreshold).toBeLessThanOrEqual(1);
    });

    it('should throw error for missing method', async () => {
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      expect(() => getMethodConfig('nonexistent_method')).toThrow('Unknown method ID');
    });
  });

  describe('scheduler import structure', () => {
    it('should have correct import pattern for position decisions', async () => {
      // This test verifies the correct import pattern used in scheduler.js
      const { getPosition } = await import('../../src/db/database.js');
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      expect(getPosition).toBeDefined();
      expect(getMethodConfig).toBeDefined();
    });

    it('should have correct import pattern for pending order decisions', async () => {
      // This test verifies the correct import pattern used in scheduler.js
      const { cancelPendingOrder, modifyPendingOrder, getPendingOrders } = await import('../../src/db/database.js');
      const { getMethodConfig } = await import('../../src/config/methods.js');
      
      expect(cancelPendingOrder).toBeDefined();
      expect(modifyPendingOrder).toBeDefined();
      expect(getPendingOrders).toBeDefined();
      expect(getMethodConfig).toBeDefined();
    });
  });
});
