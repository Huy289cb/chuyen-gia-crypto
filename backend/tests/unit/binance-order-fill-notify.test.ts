import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindMany = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetTradeEvent: {
      findMany: mockFindMany,
    },
  },
}));

import { hasEntryFillBeenNotified } from '../../src/services/binance-order-fill.service';

describe('hasEntryFillBeenNotified', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when entry_order_filled exists for order_id', async () => {
    mockFindMany.mockResolvedValue([
      {
        event_data: JSON.stringify({
          order_id: 'v3_123_abc',
          symbol: 'BTC',
        }),
      },
    ]);
    await expect(hasEntryFillBeenNotified('v3_123_abc')).resolves.toBe(true);
  });

  it('returns false when no matching order_id', async () => {
    mockFindMany.mockResolvedValue([
      { event_data: JSON.stringify({ order_id: 'v3_other' }) },
    ]);
    await expect(hasEntryFillBeenNotified('v3_123_abc')).resolves.toBe(false);
  });

  it('returns false when no events', async () => {
    mockFindMany.mockResolvedValue([]);
    await expect(hasEntryFillBeenNotified('v3_123_abc')).resolves.toBe(false);
  });
});
