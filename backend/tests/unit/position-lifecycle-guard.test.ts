import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPendingFindFirst = vi.hoisted(() => vi.fn());
const mockPositionFindUnique = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetPendingOrder: { findFirst: mockPendingFindFirst },
    testnetPosition: { findUnique: mockPositionFindUnique },
  },
}));

import {
  markWorkerStarted,
  noteEmergencyMarketClose,
  shouldDeferAbsentOnBinanceBookkeepingClose,
  shouldDeferEmergencyMarketClose,
  wasRecentEmergencyMarketClose,
} from '../../src/services/position-lifecycle-guard.service';

describe('position-lifecycle-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROTECTIVE_AUDIT_STARTUP_DELAY_MS = '0';
    process.env.POSITION_NEW_GRACE_MS = '300000';
    process.env.PROTECTIVE_AUDIT_FILL_GRACE_MS = '180000';
    markWorkerStarted();
    mockPendingFindFirst.mockResolvedValue(null);
    mockPositionFindUnique.mockResolvedValue(null);
  });

  it('defers market close during worker warmup', async () => {
    process.env.PROTECTIVE_AUDIT_STARTUP_DELAY_MS = '90000';
    markWorkerStarted();
    const result = await shouldDeferEmergencyMarketClose({
      symbol: 'BTC',
      side: 'short',
      source: 'test',
    });
    expect(result.defer).toBe(true);
    expect(result.reason).toContain('warmup');
  });

  it('defers market close when blocking pending exists', async () => {
    mockPendingFindFirst.mockResolvedValue({
      order_id: 'v3_test',
      status: 'pending',
    });

    const result = await shouldDeferEmergencyMarketClose({
      symbol: 'BTC',
      side: 'short',
      source: 'test',
    });
    expect(result.defer).toBe(true);
    expect(result.reason).toContain('v3_test');
  });

  it('defers bookkeeping absent close after emergency market close', async () => {
    noteEmergencyMarketClose('BTC', 'short', 'protective_exposure_audit');

    const result = await shouldDeferAbsentOnBinanceBookkeepingClose({
      position_id: 'pos_1',
      symbol: 'BTC',
      side: 'short',
      entry_time: new Date(Date.now() - 600_000),
    });
    expect(result.defer).toBe(true);
    expect(result.reason).toContain('emergency market close');
    expect(wasRecentEmergencyMarketClose('BTC', 'short')).toBe(true);
  });

  it('defers bookkeeping close for brand-new local position', async () => {
    const result = await shouldDeferAbsentOnBinanceBookkeepingClose({
      position_id: 'pos_new',
      symbol: 'BTC',
      side: 'long',
      entry_time: new Date(),
    });
    expect(result.defer).toBe(true);
    expect(result.reason).toContain('new-position grace');
  });
});
