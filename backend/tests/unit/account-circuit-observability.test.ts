import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindAccount = vi.hoisted(() => vi.fn());
const mockFindSnapshot = vi.hoisted(() => vi.fn());
const mockAggregateSnapshots = vi.hoisted(() => vi.fn());
const mockUpdateAccount = vi.hoisted(() => vi.fn());
const mockFindOutcomes = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: {
      findUnique: mockFindAccount,
      update: mockUpdateAccount,
    },
    testnetAccountSnapshot: {
      findFirst: mockFindSnapshot,
      aggregate: mockAggregateSnapshots,
    },
    tradeOutcome: { findMany: mockFindOutcomes },
  },
}));

import { getAccountCircuitStatus } from '../../src/services/account-circuit.service';

describe('account circuit observability scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CIRCUIT_PEAK_EQUITY', '38');
    vi.stubEnv('CIRCUIT_EXPECTANCY_SINCE', '2026-08-12T16:00:00.000Z');
    vi.stubEnv('MAX_DRAWDOWN_PERCENT', '15');
    mockFindAccount.mockResolvedValue({
      id: 1,
      starting_balance: 40,
      current_balance: 36,
      equity: 36,
      max_drawdown: 10,
    });
    mockFindSnapshot.mockResolvedValue({ equity: 36 });
    mockFindOutcomes.mockResolvedValue([]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('labels override-based drawdown and expectancy as strategy epoch without changing the gate', async () => {
    const status = await getAccountCircuitStatus(1);

    expect(status.allowed).toBe(true);
    expect(status.scope).toBe('strategy_epoch');
    expect(status.epochStart?.toISOString()).toBe('2026-08-12T16:00:00.000Z');
    expect(status.peakEquitySource).toBe('override');
    expect(status.peakEquity).toBe(38);
    expect(status.drawdownPercent).toBeCloseTo((2 / 38) * 100, 8);
    expect(mockAggregateSnapshots).not.toHaveBeenCalled();
    expect(mockFindOutcomes).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { timestamp: { gte: new Date('2026-08-12T16:00:00.000Z') } },
      })
    );
  });
});
