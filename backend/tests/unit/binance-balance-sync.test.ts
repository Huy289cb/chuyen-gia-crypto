import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAccount = vi.hoisted(() => vi.fn());
const mockPrismaUpdate = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/binance/account', () => ({
  getAccount: mockGetAccount,
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: {
      update: mockPrismaUpdate,
    },
  },
}));

import { syncTestnetAccountFromBinance } from '../../src/services/binance-balance-sync.service';

describe('binance-balance-sync demo -1109', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BINANCE_BASE_URL = 'https://demo-fapi.binance.com';
  });

  it('returns null without DB write when demo metadata returns -1109', async () => {
    const error = new Error('Binance API Error -1109: Invalid account.') as Error & {
      binanceCode: number;
    };
    error.binanceCode = -1109;
    mockGetAccount.mockRejectedValue(error);

    const result = await syncTestnetAccountFromBinance(1);

    expect(result).toBeNull();
    expect(mockPrismaUpdate).not.toHaveBeenCalled();
  });

  it('syncs wallet when account endpoint succeeds', async () => {
    mockGetAccount.mockResolvedValue({
      assets: [{ asset: 'USDT', walletBalance: 5000, unrealizedProfit: 10 }],
      totalWalletBalance: 5000,
      totalUnrealizedProfit: 10,
      totalMarginBalance: 5010,
    });

    const result = await syncTestnetAccountFromBinance(2);

    expect(result).toEqual({
      walletBalance: 5000,
      unrealizedPnl: 10,
      equity: 5010,
    });
    expect(mockPrismaUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: expect.objectContaining({
        current_balance: 5000,
        equity: 5010,
        unrealized_pnl: 10,
      }),
    });
  });
});
