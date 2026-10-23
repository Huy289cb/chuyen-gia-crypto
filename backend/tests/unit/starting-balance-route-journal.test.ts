import {replayRecordedStartingBalance as replay} from '../../src/utils/recorded-starting-balance';
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const sync=vi.hoisted(()=>vi.fn());const journal=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/services/binance-balance-sync.service',()=>({syncTestnetAccountFromBinance:sync}));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:journal}));
import router from '../../src/routes/testnet';
const handler=(router as any).stack.find((l:any)=>l.route?.path==='/sync/:accountId').route.stack[0].handle;
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('BINANCE_ENABLED','true');sync.mockResolvedValue({walletBalance:31,equity:32,unrealizedPnl:1});});
afterEach(()=>vi.unstubAllEnvs());
async function run(totalTrades:number,fail=false,snapshotFail=false){const update=vi.fn().mockImplementation(async()=>{if(fail)throw Error('DB failed');});const db={testnetAccount:{findUnique:async()=>({id:1,total_trades:totalTrades,starting_balance:30,realized_pnl:0}),update},testnetAccountSnapshot:{create:vi.fn().mockImplementation(async()=>{if(snapshotFail)throw Error('snapshot failed');return {};})},testnetPosition:{count:async()=>0}};const res:any={statusCode:200,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;return this;}};await handler({params:{accountId:'1'},prisma:db},res);return {update,res};}
it('records successful zero-trade capital field overwrite without treating it as PnL',async()=>{
 const {update,res}=await run(0);expect(res.body.success).toBe(true);expect(update).toHaveBeenCalledWith({where:{id:1},data:{starting_balance:31}});
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));expect(journal.mock.calls[0]).toEqual([expect.objectContaining({schema:'account-starting-balance-sync-v1',account_id:1,input:{total_trades:0,previous_starting_balance:30,wallet_balance:31},update:{starting_balance:31},applied_clock_source:'db_update_return'}),'account_starting_balance_sync_applied']);
});
it('does not overwrite starting balance after trades',async()=>{const {update}=await run(1);expect(update).not.toHaveBeenCalled();expect(journal).not.toHaveBeenCalled();});
it('does not journal failed starting balance writes',async()=>{const {res}=await run(0,true);expect(res.statusCode).toBe(500);expect(journal).not.toHaveBeenCalled();});
it('does not await pending journal persistence',async()=>{journal.mockImplementationOnce(()=>new Promise(()=>{}));expect((await run(0)).res.body.success).toBe(true);});

it('retains successful capital write evidence when later snapshot persistence fails',async()=>{
 const {res,update}=await run(0,false,true);expect(res.statusCode).toBe(500);expect(update).toHaveBeenCalledTimes(1);
 await vi.waitFor(()=>expect(journal).toHaveBeenCalledTimes(1));
 expect(journal.mock.calls[0][0]).toMatchObject({update:{starting_balance:31}});
 expect(replay(journal.mock.calls[0][0],Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:true,economic_initial_capital:null});
});
