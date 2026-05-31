import { describe, expect, it } from 'vitest';
import {
  deriveWalletBaseline,
  type BinanceIncomeSummary,
} from '../../src/services/binance-income.service';

describe('binance-income / wallet baseline', () => {
  it('deriveWalletBaseline excludes TRANSFER top-ups', () => {
    const income: BinanceIncomeSummary = {
      realizedPnl: -20.6,
      commission: -3.83,
      fundingFee: -0.51,
      transferNet: 15000,
      netTradingPnl: -24.94,
      rowCount: 24,
    };
    expect(deriveWalletBaseline(4975.06, income)).toBeCloseTo(5000, 0);
  });

  it('wallet delta matches net trading pnl after rebaseline', () => {
    const wallet = 4975.06;
    const income: BinanceIncomeSummary = {
      realizedPnl: -20.6,
      commission: -3.83,
      fundingFee: -0.51,
      transferNet: 15000,
      netTradingPnl: -24.94,
      rowCount: 24,
    };
    const baseline = deriveWalletBaseline(wallet, income);
    expect(wallet - baseline).toBeCloseTo(income.netTradingPnl, 2);
  });
});
