import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const mocks=vi.hoisted(()=>({positions:vi.fn(),events:vi.fn(),bars:vi.fn(),now:vi.fn(),get:vi.fn()}));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetPosition:{findMany:mocks.positions},testnetTradeEvent:{findMany:mocks.events}}}));
vi.mock('../../src/services/binance/market',()=>({getKlines:mocks.bars,getServerTime:mocks.now}));
vi.mock('../../src/services/binance/client',()=>({get:mocks.get}));
import {runPostExitObserver} from '../../src/services/post-exit-observer.service';
let dir='';afterEach(()=>{vi.unstubAllEnvs();if(dir)rmSync(dir,{recursive:true,force:true});});
it('backfills idempotently and archives a changed reconciled exit without production writes',async()=>{
 dir=mkdtempSync(join(tmpdir(),'exit-observer-'));vi.stubEnv('POST_EXIT_DATA_DIR',dir);
 const start=Date.parse('2026-08-01T00:00:00Z');const p={position_id:'p',side:'long',symbol:'BTC',entry_price:100,entry_time:new Date(start),close_time:new Date(start+60000),close_price:90,realized_pnl:-.011,size_qty:.001,entry_fee:0,exit_fee:.001,funding_fee:0,close_reason:'test'};
 mocks.positions.mockResolvedValue([p]);mocks.events.mockImplementation(async(a)=>a.where.event_type==='entry_order_filled'?[{position_id:'p',event_data:JSON.stringify({decision_id:55,stop_loss:90,take_profit:115})}]:[]);
 mocks.now.mockResolvedValue(start+75*3600000);mocks.bars.mockImplementation(async(_s,_tf,_limit,from,to)=>Array.from({length:(to+1-from)/60000},(_,i)=>({openTime:from+i*60000,open:100,high:116,low:89,close:100})));
 await runPostExitObserver();const calls=mocks.bars.mock.calls.length;expect(calls).toBeGreaterThan(0);await runPostExitObserver();expect(mocks.bars.mock.calls.length).toBe(calls);
 p.close_time=new Date(start+120000);p.realized_pnl=-.012;await runPostExitObserver();expect(readdirSync(join(dir,'revisions'))).toHaveLength(1);
 const result=JSON.parse(readFileSync(join(dir,'positions/p.json'),'utf8'));expect(result.result.position.net).toBe(-.012);expect(result.result.after.every((w:any)=>w.status==='complete')).toBe(true);
});
