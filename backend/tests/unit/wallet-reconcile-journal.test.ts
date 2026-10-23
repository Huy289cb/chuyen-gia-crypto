import {it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({find:vi.fn(),positions:vi.fn(),update:vi.fn(),wallet:vi.fn(),income:vi.fn(),journal:vi.fn()}));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetAccount:{findUnique:m.find,update:m.update},testnetPosition:{findMany:m.positions}}}));
vi.mock('../../src/repositories/testnet.repository',()=>({PIPELINE_EVENT_POSITION_ID:'pipeline_v3_kim_nghia'}));
vi.mock('../../src/services/binance-balance-sync.service',()=>({fetchBinanceBalanceSnapshot:m.wallet}));
vi.mock('../../src/services/binance-income.service',()=>({fetchBinanceIncomeSummary:m.income}));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:m.journal}));
import {reconcileTestnetWalletFromBinance as reconcile} from '../../src/services/wallet-reconcile.service';
import {replayRecordedWalletReconcile as replay} from '../../src/utils/recorded-wallet-reconcile';
beforeEach(()=>{
 vi.clearAllMocks();m.find.mockResolvedValue({starting_balance:32,realized_pnl:-2});m.positions.mockResolvedValue([{realized_pnl:-1,entry_fee:.1,exit_fee:.2,funding_fee:-.03}]);
 m.wallet.mockResolvedValue({walletBalance:30,equity:31,unrealizedPnl:1});m.income.mockResolvedValue({netTradingPnl:-2,realizedPnl:-1,transferNet:0,commission:-.3,fundingFee:.03,rowCount:3});m.update.mockResolvedValue({});m.journal.mockResolvedValue(undefined);
});
it('records only a successful account overwrite and replays the captured inputs',async()=>{
 const result=await reconcile(1);expect(result.positionRealizedSum).toBe(-1);
 await vi.waitFor(()=>expect(m.journal).toHaveBeenCalledOnce());
 const [payload,type]=m.journal.mock.calls[0];expect(type).toBe('account_wallet_reconcile_applied');expect(payload.reconcile_attempt_id).toMatch(/^[0-9a-f-]{36}$/);
 expect(replay(payload,Date.now(),Date.now())).toMatchObject({status:'evaluated',matches_recorded:true,economic_total_pnl:null});
 expect(m.update.mock.calls[0][0].data.realized_pnl).toBe(-1);
});
it('failed DB update emits no applied reconciliation event',async()=>{
 m.update.mockRejectedValueOnce(new Error('db failed'));await expect(reconcile(1)).rejects.toThrow('db failed');expect(m.journal).not.toHaveBeenCalled();
});
it('rejected and pending journals do not block reconciliation',async()=>{
 m.journal.mockRejectedValueOnce(new Error('journal'));await expect(reconcile(1)).resolves.toMatchObject({accountId:1});
 await vi.waitFor(()=>expect(m.journal).toHaveBeenCalledOnce());m.journal.mockImplementationOnce(()=>new Promise(()=>{}));
 await expect(reconcile(1)).resolves.toMatchObject({accountId:1});
});
