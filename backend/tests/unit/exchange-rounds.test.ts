import { describe, it, expect } from 'vitest';
import { reconstructExchangeRounds, type ExchangeFill } from '../../src/utils/exchange-rounds';
import { computeExecutionRisk } from '../../src/utils/execution-risk';
const fill = (id: number, side: string, qty: number, pnl = 0, price = 100): ExchangeFill =>
  ({ tradeId: id, orderId: id, side, qty, realizedPnl: pnl, price, commission: 0.01, commissionAsset: 'USDT', time: id * 1000 });
describe('exchange round accounting', () => {
  it('counts a zero gross PnL close as a net loss including both commissions and funding', () => {
    const r = reconstructExchangeRounds([fill(1, 'BUY', 1), fill(3, 'SELL', 1)],
      [{ incomeType: 'FUNDING_FEE', income: '-0.03', time: 2000, tranId: 5, asset: 'USDT' }]);
    expect(r).toHaveLength(1); expect(r[0].netPnl).toBeCloseTo(-0.05); expect(r[0].grossPnl).toBe(0);
  });
  it('does not count a partial close as a completed trade, and permits adding after reducing', () => {
    const fills = [fill(1, 'SELL', 2), fill(2, 'BUY', 1, 2, 98), fill(3, 'SELL', 1)];
    expect(reconstructExchangeRounds(fills)).toHaveLength(0);
    const r = reconstructExchangeRounds([...fills, fill(4, 'BUY', 2, 4, 98)])[0];
    expect(r.quantity).toBe(3); expect(r.entryPrice).toBe(100); expect(r.closePrice).toBe(98);
    expect(r.netPnl).toBeCloseTo(5.96);
  });
  it('deduplicates fills and income, preserving signed funding credits', () => {
    const a = fill(1, 'BUY', 1), b = fill(3, 'SELL', 1, 1, 101);
    const income = { incomeType: 'FUNDING_FEE', income: '0.04', time: 2000, tranId: 6 };
    const r = reconstructExchangeRounds([b, a, a, b], [income, income])[0];
    expect(r.netPnl).toBeCloseTo(1.02); expect(r.fundingFee).toBe(-0.04);
  });
  it('allocates flip commission and leaves the new position open', () => {
    const r = reconstructExchangeRounds([fill(1, 'BUY', 1), fill(2, 'SELL', 2, 10, 110)]);
    expect(r).toHaveLength(1); expect(r[0].exitFee).toBeCloseTo(0.005);
  });
  it('refuses to fabricate a round when the opening fill is missing', () => {
    expect(reconstructExchangeRounds([fill(1, 'SELL', 1, 10)])).toHaveLength(0);
  });
  it('fails closed when commissions cannot be valued in USDT', () => {
    expect(() => reconstructExchangeRounds([{ ...fill(1, 'BUY', 1), commissionAsset: 'BNB' }])).toThrow('conversion');
  });
});
describe('cost-aware execution risk', () => {
  it('rejects the audited minimum BTC lot after costs although its price risk fits 2%', () => {
    const r = computeExecutionRisk({ entry: 79591.5, stopLoss: 79591.5 * 0.992, quantity: 0.001, balance: 34.27714639 });
    expect(r.priceRiskUsd / 34.27714639 * 100).toBeLessThan(2);
    expect(r.riskPercent).toBeGreaterThan(2);
    expect(r.totalRiskUsd).toBeCloseTo(0.795915, 6);
  });
  it('reserves short exit fees on the higher stop notional and rejects invalid inputs', () => {
    expect(computeExecutionRisk({ entry: 100, stopLoss: 110, quantity: 1, balance: 100 }).feeReserveUsd).toBeCloseTo(0.11);
    expect(() => computeExecutionRisk({ entry: 100, stopLoss: 99, quantity: 1, balance: 0 })).toThrow();
  });
});
