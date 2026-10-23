import {it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({positions:vi.fn(),update:vi.fn(),outcomes:vi.fn(),journal:vi.fn()}));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetPosition:{findMany:m.positions},testnetAccount:{update:m.update},tradeOutcome:{findMany:m.outcomes}}}));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:m.journal}));
vi.mock('../../src/repositories/testnet.repository',()=>({PIPELINE_EVENT_POSITION_ID:'pipeline_v3_kim_nghia'}));
import {rebuildNetTradeStatistics as rebuild} from '../../src/services/position-pnl-reconcile.service';
import {replayRecordedNetStatistics as replay} from '../../src/utils/recorded-net-statistics';
beforeEach(()=>{vi.clearAllMocks();m.positions.mockResolvedValue([{position_id:'p1',close_time:new Date(Date.now()-10000),realized_pnl:-1,entry_fee:.1,exit_fee:.2,funding_fee:-.03}]);m.update.mockResolvedValue({});m.outcomes.mockResolvedValue([]);m.journal.mockResolvedValue(undefined);});
it('replays successful account statistics and rejects missing fees or duplicate rows',async()=>{
 await rebuild(1);await vi.waitFor(()=>expect(m.journal).toHaveBeenCalledOnce());const [e,type]=m.journal.mock.calls[0];expect(type).toBe('account_net_statistics_applied');
 expect(replay(e,Date.now(),Date.now())).toMatchObject({status:'evaluated',matches_recorded:true,economic_total_pnl:null});
 const missing=structuredClone(e);delete missing.input.positions[0].entry_fee;expect(replay(missing,Date.now(),Date.now()).status).toBe('unknown');
 const duplicate=structuredClone(e);duplicate.input.positions.push(duplicate.input.positions[0]);expect(replay(duplicate,Date.now(),Date.now()).status).toBe('unknown');
});
it('failed account write has no applied event',async()=>{m.update.mockRejectedValueOnce(new Error('db'));await expect(rebuild(1)).rejects.toThrow('db');expect(m.journal).not.toHaveBeenCalled();});
it('pending or rejected journal does not prevent the remaining statistics work',async()=>{
 m.journal.mockRejectedValueOnce(new Error('journal'));await rebuild(1);await vi.waitFor(()=>expect(m.journal).toHaveBeenCalledOnce());
 m.journal.mockImplementationOnce(()=>new Promise(()=>{}));await rebuild(1);expect(m.outcomes).toHaveBeenCalledTimes(2);
});
