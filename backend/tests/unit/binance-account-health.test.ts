import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/binance/trading', () => ({
  testOrder: vi.fn(),
}));

import { testOrder } from '../../src/services/binance/trading';
import {
  BINANCE_INVALID_ACCOUNT_CODE,
  checkBinanceAccountTradable,
  clearBinanceAccountHealthCache,
  formatBinanceInvalidAccountMessage,
  isBinanceDemoMetadataUnavailableError,
  isBinanceInvalidAccountError,
  isBinanceAccountKnownUnhealthy,
  recordBinanceTradingAccessObserved,
} from '../../src/services/binance-account-health.service';

describe('binance-account-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBinanceAccountHealthCache();
    process.env.BINANCE_ENABLED = 'true';
    process.env.BINANCE_BASE_URL = 'https://demo-fapi.binance.com';
  });

  it('detects -1109 from BinanceApiError shape', () => {
    const error = new Error(`Binance API Error ${BINANCE_INVALID_ACCOUNT_CODE}: Invalid account.`) as Error & {
      binanceCode: number;
    };
    error.binanceCode = BINANCE_INVALID_ACCOUNT_CODE;
    expect(isBinanceInvalidAccountError(error)).toBe(true);
  });

  it('treats demo metadata -1109 as unavailable metadata, not inactive wallet', () => {
    const error = new Error(`Binance API Error ${BINANCE_INVALID_ACCOUNT_CODE}: Invalid account.`) as Error & {
      binanceCode: number;
    };
    error.binanceCode = BINANCE_INVALID_ACCOUNT_CODE;
    expect(isBinanceDemoMetadataUnavailableError(error)).toBe(true);
  });

  it('returns tradable when order/test probe succeeds', async () => {
    vi.mocked(testOrder).mockResolvedValue({});

    const result = await checkBinanceAccountTradable(true);
    expect(result.tradable).toBe(true);
    expect(result.reason).toContain('order/test');
    expect(isBinanceAccountKnownUnhealthy()).toBe(false);
  });

  it('soft-passes demo when order/test returns -1109 (inconclusive)', async () => {
    const error = new Error(`Binance API Error ${BINANCE_INVALID_ACCOUNT_CODE}: Invalid account.`) as Error & {
      binanceCode: number;
    };
    error.binanceCode = BINANCE_INVALID_ACCOUNT_CODE;
    vi.mocked(testOrder).mockRejectedValue(error);

    const result = await checkBinanceAccountTradable(true);
    expect(result.tradable).toBe(true);
    expect(result.reason).toContain('-1109');
    expect(result.reason).toContain('inconclusive');
    expect(isBinanceAccountKnownUnhealthy()).toBe(false);
  });

  it('uses cached trading observation when demo order/test returns -1109', async () => {
    const error = new Error(`Binance API Error ${BINANCE_INVALID_ACCOUNT_CODE}: Invalid account.`) as Error & {
      binanceCode: number;
    };
    error.binanceCode = BINANCE_INVALID_ACCOUNT_CODE;
    recordBinanceTradingAccessObserved('openOrders');
    vi.mocked(testOrder).mockRejectedValue(error);

    const result = await checkBinanceAccountTradable(true);
    expect(result.tradable).toBe(true);
    expect(result.reason).toContain('openOrders');
  });

  it('returns actionable message when order/test returns -1109 on production', async () => {
    process.env.BINANCE_BASE_URL = 'https://fapi.binance.com';
    const error = new Error(`Binance API Error ${BINANCE_INVALID_ACCOUNT_CODE}: Invalid account.`) as Error & {
      binanceCode: number;
    };
    error.binanceCode = BINANCE_INVALID_ACCOUNT_CODE;
    vi.mocked(testOrder).mockRejectedValue(error);

    const result = await checkBinanceAccountTradable(true);
    expect(result.tradable).toBe(false);
    expect(result.reason).toContain('-1109');
    expect(isBinanceAccountKnownUnhealthy()).toBe(true);
  });

  it('formatBinanceInvalidAccountMessage mentions demo metadata caveat', () => {
    const msg = formatBinanceInvalidAccountMessage();
    expect(msg).toContain('BINANCE_BASE_URL');
    expect(msg).toContain('balance/position');
  });
});
