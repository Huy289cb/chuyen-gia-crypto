import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAccount = vi.hoisted(() => vi.fn());
const mockPrismaUpdate = vi.hoisted(() => vi.fn());
const mockWalletJournal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/utils/account-wallet-journal', () => ({persistAccountWalletObservation: mockWalletJournal}));

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

import { replayRecordedWalletSync } from '../../src/utils/recorded-wallet-sync';
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

    const observer=vi.fn();
    const result = await syncTestnetAccountFromBinance(1,observer);
    expect(observer.mock.calls[0][0].status).toBe('metadata_unavailable');

    expect(result).toBeNull();
    expect(mockPrismaUpdate).not.toHaveBeenCalled();
  });

  it('retains query error and emits no applied wallet write',async()=>{
    const error=new Error('query timeout'),observer=vi.fn();mockGetAccount.mockRejectedValueOnce(error);
    await expect(syncTestnetAccountFromBinance(1,observer)).rejects.toBe(error);expect(mockPrismaUpdate).not.toHaveBeenCalled();
    expect(observer.mock.calls[0][0].status).toBe('query_failed');
  });
  it('failed DB write does not emit an applied wallet event',async()=>{
    mockGetAccount.mockResolvedValueOnce({assets:[{asset:'USDT',walletBalance:30}],totalWalletBalance:30,totalUnrealizedProfit:0,totalMarginBalance:30});
    const error=new Error('db unavailable'),observer=vi.fn();mockPrismaUpdate.mockRejectedValueOnce(error);
    await expect(syncTestnetAccountFromBinance(1,observer)).rejects.toBe(error);expect(observer).not.toHaveBeenCalled();
  });
  it('observer error cannot interrupt an applied sync',async()=>{
    mockGetAccount.mockResolvedValue({assets:[{asset:'USDT',walletBalance:30}],totalWalletBalance:30,totalUnrealizedProfit:0,totalMarginBalance:30});
    const result=await syncTestnetAccountFromBinance(1,()=>{throw Error('observer unavailable');});
    expect(result?.walletBalance).toBe(30);expect(mockPrismaUpdate).toHaveBeenCalledOnce();
  });

  it('records account evidence without an optional close observer', async()=>{
    mockGetAccount.mockResolvedValueOnce({assets:[{asset:'USDT',walletBalance:30}],totalWalletBalance:30,totalUnrealizedProfit:0,totalMarginBalance:30});
    await syncTestnetAccountFromBinance(1);
    await vi.waitFor(()=>expect(mockWalletJournal).toHaveBeenCalledOnce());
    expect(mockWalletJournal.mock.calls[0][0]).toMatchObject({account_id:1,status:'applied',schema:'wallet-sync-v1'});
  });

  it('journal rejection or a pending journal cannot block wallet writes', async()=>{
    mockGetAccount.mockResolvedValue({assets:[{asset:'USDT',walletBalance:30}],totalWalletBalance:30,totalUnrealizedProfit:0,totalMarginBalance:30});
    mockWalletJournal.mockRejectedValueOnce(new Error('journal failed'));
    expect((await syncTestnetAccountFromBinance(1))?.walletBalance).toBe(30);
    await vi.waitFor(()=>expect(mockWalletJournal).toHaveBeenCalledOnce());
    mockWalletJournal.mockImplementationOnce(()=>new Promise(()=>{}));
    const result=await Promise.race([syncTestnetAccountFromBinance(1),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('blocked')),500))]);
    expect(result?.walletBalance).toBe(30);
  });

  it('syncs wallet when account endpoint succeeds', async () => {
    mockGetAccount.mockResolvedValue({
      assets: [{ asset: 'USDT', walletBalance: 5000, unrealizedProfit: 10 }],
      totalWalletBalance: 5000,
      totalUnrealizedProfit: 10,
      totalMarginBalance: 5010,
    });

    const observer=vi.fn();
    const result = await syncTestnetAccountFromBinance(2,observer);
    const evidence=JSON.parse(JSON.stringify(observer.mock.calls[0][0])),at=Date.now();
    const replay=replayRecordedWalletSync(evidence,at,at);expect(replay.status).toBe('evaluated');if(replay.status==='evaluated')expect(replay.matches_recorded).toBe(true);
    evidence.update.current_balance=4999;const mismatch=replayRecordedWalletSync(evidence,at,at);if(mismatch.status==='evaluated')expect(mismatch.matches_recorded).toBe(false);
    expect(replayRecordedWalletSync(evidence,at,at-1).status).toBe('unknown');

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
