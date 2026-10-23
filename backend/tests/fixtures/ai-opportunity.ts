import type { AiOpportunityPolicy } from '../../src/config/ai-opportunity-policy';
import { buildOpportunitySnapshot, type OpportunityCandle, type OpportunityFinance } from '../../src/utils/ai-opportunity';

export function opportunityFixture() {
  const now = Date.parse('2026-09-11T16:01:00Z');
  const policy: AiOpportunityPolicy = { version: 'btc-plans-v1', minRr: 3, minSlFraction: .008,
    maxRiskPercent: 3, maxRiskUsd: null, dailyPercent: 10, targetPercent: .5, feePercent: .1,
    slippagePercent: .1, maxExposure: 1000, model: 'fixture-model', timeoutMs: 100,
    dailyRequests: 12, ttlMs: 180000, maxSnapshotAgeMs: 120000, maxPriceDriftFraction: .0025,
    mode: 'shadow', pinned: true, hash: 'fixture-policy' };
  const finance: OpportunityFinance = { balance: 100, remainingDailyRiskUsd: 10, remainingExposureUsd: 1000,
    allowed: true, stepSize: .001, minQty: .001, minNotional: 50, fundingRate: .0001 };
  const rows = (step: number, flat = false): OpportunityCandle[] => Array.from({ length: 100 }, (_, i) => {
    const close = flat ? 85000 : 79000 + i * 10;
    return { timestamp: Math.floor(now / step) * step - (100 - i) * step,
      open: close - 2, high: close + 5, low: close - 5, close, volume: 100 };
  });
  const candles = { '5m': rows(300000), '15m': rows(900000), '1h': rows(3600000), '4h': rows(14400000, true) };
  candles['15m'][98].low = 79500;
  Object.assign(candles['15m'][99], { open: 79950, close: 80060, high: 80070, low: 79930 });
  candles['4h'][88].high = 90000; candles['4h'][96].high = 94000;
  candles['4h'][89].low = 76000; candles['4h'][97].low = 77000;
  const snapshot = buildOpportunitySnapshot({ asOf: now, candles, finance, policy })!;
  if (!snapshot?.plans.length) throw new Error('Fixture must produce a valid plan');
  return { now, policy, finance, candles, snapshot, plan: snapshot.plans[0] };
}
