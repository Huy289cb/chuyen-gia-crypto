import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindUniqueAccount = vi.hoisted(() => vi.fn());
const mockUpdateAccount = vi.hoisted(() => vi.fn());
const mockGetBinanceLossStreak = vi.hoisted(() => vi.fn());
const mockSetTestnetAccountCooldown = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: {
      findUnique: mockFindUniqueAccount,
      update: mockUpdateAccount,
    },
  },
}));

vi.mock('../../src/repositories/testnet.repository', () => ({
  setTestnetAccountCooldown: mockSetTestnetAccountCooldown,
}));

vi.mock('../../src/services/binance-trade-history.service', () => ({
  getBinanceLossStreak: mockGetBinanceLossStreak,
}));

import { assertTestnetAccountCanOpenTrade } from '../../src/services/account-risk-guard.service';
import {
  clearProtectiveExposureEntryBlock,
  setProtectiveExposureEntryBlock,
} from '../../src/services/protective-exposure-state';

describe('account risk guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProtectiveExposureEntryBlock();
    process.env.BINANCE_ENABLED = 'true';
    process.env.MAX_CONSECUTIVE_LOSSES = '2';
    process.env.CONSECUTIVE_LOSS_COOLDOWN_HOURS = '4';
    mockFindUniqueAccount.mockResolvedValue({
      id: 1,
      cooldown_until: null,
      consecutive_losses: 0,
    });
    mockGetBinanceLossStreak.mockResolvedValue({
      consecutiveLosses: 0,
      lastLossTime: 0,
    });
  });

  it('blocks entries while protective exposure audit lock is active', async () => {
    setProtectiveExposureEntryBlock('Unprotected BTC long exposure missing SL', 60000);

    const result = await assertTestnetAccountCanOpenTrade(1, 'BTC');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Protective exposure audit blocked entries');
    expect(mockGetBinanceLossStreak).not.toHaveBeenCalled();
  });

  it('blocks entries from Binance loss streak', async () => {
    mockGetBinanceLossStreak.mockResolvedValue({
      consecutiveLosses: 2,
      lastLossTime: Date.now() - 30 * 60_000,
    });

    const result = await assertTestnetAccountCanOpenTrade(1, 'BTC');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Binance loss streak 2');
  });

  it('clears expired cooldown_until before allowing entries', async () => {
    mockFindUniqueAccount.mockResolvedValue({
      id: 1,
      cooldown_until: new Date(Date.now() - 60_000),
      consecutive_losses: 2,
    });

    const result = await assertTestnetAccountCanOpenTrade(1, 'BTC');

    expect(result.allowed).toBe(true);
    expect(mockUpdateAccount).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { cooldown_until: null },
    });
  });
});
