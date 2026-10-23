import {replayRecordedBackfillStatistics as replay} from '../../src/utils/recorded-backfill-statistics';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const journal=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:journal}));
const find=vi.hoisted(()=>vi.fn());const update=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));const reconcile=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetPosition:{findMany:find},testnetAccount:{update}}}));
vi.mock('../../src/services/wallet-reconcile.service',()=>({reconcileTestnetWalletFromBinance:reconcile}));
import {recomputeTestnetAccountTradeStats} from '../../src/services/position-pnl-backfill.service';
beforeEach(()=>{vi.clearAllMocks();find.mockResolvedValue([{position_id:'p1',realized_pnl:1,close_reason:'manual'},{position_id:'p2',realized_pnl:-.01,close_reason:'stop_loss'},{position_id:'p3',realized_pnl:-2,close_reason:'reconciliation_fill'},{position_id:'p4',realized_pnl:null,close_reason:'manual'}]);});
afterEach(()=>vi.unstubAllEnvs());
it('preserves Binance wallet reconciliation without adding a local realized PnL overwrite',async()=>{
 vi.stubEnv('BINANCE_ENABLED','true');await recomputeTestnetAccountTradeStats(1);
 expect(update).toHaveBeenCalledTimes(1);expect(update.mock.calls[0][0]).toMatchObject({where:{id:1},data:{total_trades:3,winning_trades:1,losing_trades:0}});
 expect(update.mock.calls[0][0].data).not.toHaveProperty('realized_pnl');expect(reconcile).toHaveBeenCalledWith(1);
});
it('preserves separate paper realized PnL overwrite',async()=>{
 vi.stubEnv('BINANCE_ENABLED','false');await recomputeTestnetAccountTradeStats(1);
 expect(update).toHaveBeenCalledTimes(2);expect(update.mock.calls[1][0]).toMatchObject({data:{realized_pnl:.99}});expect(reconcile).not.toHaveBeenCalled();
});

it('records successful statistics despite later wallet reconciliation failure',async()=>{
 vi.stubEnv('BINANCE_ENABLED','true');reconcile.mockRejectedValueOnce(new Error('wallet failed'));
 await expect(recomputeTestnetAccountTradeStats(1)).rejects.toThrow('wallet failed');
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 expect(journal.mock.calls[0]).toEqual([expect.objectContaining({kind:'trade_statistics_overwrite',account_id:1,applied_clock_source:'db_update_return'}),'account_backfill_statistics_applied']);
});
it('does not journal a failed first DB write',async()=>{
 vi.stubEnv('BINANCE_ENABLED','true');update.mockRejectedValueOnce(new Error('DB failed'));
 await expect(recomputeTestnetAccountTradeStats(1)).rejects.toThrow('DB failed');expect(journal).not.toHaveBeenCalled();expect(reconcile).not.toHaveBeenCalled();
});
it('does not await journal persistence and records both paper writes separately',async()=>{
 vi.stubEnv('BINANCE_ENABLED','false');journal.mockImplementationOnce(()=>new Promise(()=>{}));
 await recomputeTestnetAccountTradeStats(1);await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(2));
 const events=journal.mock.calls.map(c=>c[0]);expect(events.map(e=>e.kind)).toEqual(['trade_statistics_overwrite','paper_realized_overwrite']);expect(events[0].backfill_attempt_id).not.toBe(events[1].backfill_attempt_id);
});
it('retains first successful write when the second paper DB write fails',async()=>{
 vi.stubEnv('BINANCE_ENABLED','false');update.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('second write failed'));
 await expect(recomputeTestnetAccountTradeStats(1)).rejects.toThrow('second write failed');
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 expect(journal.mock.calls[0][0].kind).toBe('trade_statistics_overwrite');
});

it('replays both actual generated JSON payloads and retains null PnL as local bookkeeping only',async()=>{
 vi.stubEnv('BINANCE_ENABLED','false');await recomputeTestnetAccountTradeStats(1);
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(2));
 for(const call of journal.mock.calls)expect(replay(JSON.parse(JSON.stringify(call[0])),Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:true,economic_total_pnl:null});
});
it('distinguishes nonfinite PnL from null across JSON serialization',async()=>{
 vi.stubEnv('BINANCE_ENABLED','true');find.mockResolvedValue([{position_id:'p1',close_reason:'manual',realized_pnl:'invalid'}]);
 await recomputeTestnetAccountTradeStats(1);await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 const event=JSON.parse(JSON.stringify(journal.mock.calls[0][0]));expect(event.input.positions[0]).toMatchObject({realized_pnl:null,pnl_status:'nonfinite'});
 expect(replay(event,Date.now(),Date.now()+100)).toMatchObject({status:'unknown'});
});
it('rejects duplicate row identities and old ambiguous schema, and detects altered writes',async()=>{
 vi.stubEnv('BINANCE_ENABLED','true');await recomputeTestnetAccountTradeStats(1);await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 const event=JSON.parse(JSON.stringify(journal.mock.calls[0][0]));
 expect(replay({...event,schema:'account-backfill-statistics-v1'},Date.now(),Date.now()+100)).toMatchObject({status:'unknown'});
 expect(replay({...event,input:{positions:[...event.input.positions,event.input.positions[0]]}},Date.now(),Date.now()+100)).toMatchObject({status:'unknown'});
 expect(replay({...event,update:{...event.update,total_trades:99}},Date.now(),Date.now()+100)).toMatchObject({matches_recorded:false});
});
