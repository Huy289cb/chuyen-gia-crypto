import {replayRecordedManualClose as replay} from '../../src/utils/recorded-manual-close';
import {it,expect,vi,beforeEach} from 'vitest';
const journal=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:journal}));
vi.mock('../../src/services/price-fetcher',()=>({fetchRealTimePrices:async()=>({btc:{price:100}})}));
import router from '../../src/routes/testnet';
const handler=(router as any).stack.find((l:any)=>l.route?.path==='/positions/:id/close').route.stack[0].handle;
beforeEach(()=>vi.clearAllMocks());
async function run(f:{accountFail?:boolean;eventFail?:boolean}={}){
 const update=vi.fn().mockImplementation(async()=>{if(f.accountFail)throw Error('account failed');});
 const db={testnetPosition:{findUnique:async()=>({position_id:'p',account_id:1,status:'open',symbol:'BTC',side:'long',entry_price:99,size_qty:1,account:{current_balance:30}}),update:async()=>({position_id:'p',status:'closed'})},testnetAccount:{update},testnetTradeEvent:{create:async()=>{if(f.eventFail)throw Error('event failed');}}};
 const res:any={statusCode:200,status(c:number){this.statusCode=c;return this;},json(v:any){this.body=v;return this;}};
 await handler({params:{id:'p'},body:{},prisma:db},res);return {update,res};
}
it('records successful manual account write as local mark PnL without claiming exchange close',async()=>{
 const {res,update}=await run();expect(res.body.success).toBe(true);expect(update.mock.calls[0][0].data.current_balance).toBe(31);
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));expect(journal.mock.calls[0]).toEqual([expect.objectContaining({schema:'account-manual-close-v1',account_id:1,position_id:'p',pnl_basis:'local_mark_price',exchange_close_verified:false,applied_clock_source:'db_update_return'}),'account_manual_close_applied']);
});
it('does not record an account write that fails after position write',async()=>{expect((await run({accountFail:true})).res.statusCode).toBe(500);expect(journal).not.toHaveBeenCalled();});
it('retains account evidence when subsequent position event fails',async()=>{expect((await run({eventFail:true})).res.statusCode).toBe(500);await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));});
it('does not wait for journal persistence',async()=>{journal.mockImplementationOnce(()=>new Promise(()=>{}));expect((await run()).res.body.success).toBe(true);});

it('replays the serialized producer payload and rejects altered increments',async()=>{
 await run();await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 const payload=JSON.parse(JSON.stringify(journal.mock.calls[0][0]));
 expect(replay(payload,Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:true,economic_total_pnl:null});
 payload.update.realized_pnl.increment=999;
 expect(replay(payload,Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:false});
});
it('rejects missing provenance, future applied time, nonfinite input and exchange verification claims',async()=>{
 await run();await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));const original=journal.mock.calls[0][0];
 for(const mutate of [(p:any)=>delete p.applied_clock_source,(p:any)=>p.applied_at='2099-01-01T00:00:00Z',(p:any)=>p.input.balance=null,(p:any)=>p.exchange_close_verified=true,(p:any)=>p.manual_close_attempt_id='invalid']){
  const p=JSON.parse(JSON.stringify(original));mutate(p);expect(replay(p,Date.now(),Date.now()+100).status).toBe('unknown');
 }
});
