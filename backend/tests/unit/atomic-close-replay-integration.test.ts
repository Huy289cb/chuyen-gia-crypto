import {it,expect,vi} from 'vitest';
import {commitAtomicVerifiedClose,replayAtomicVerifiedClose} from '../../src/utils/atomic-verified-close';
import {projectSeededLocalMaterialization} from '../../src/utils/seeded-local-materialization';
import {replayAccountOverwriteTimeline} from '../../src/utils/recorded-account-timeline';
import {buildObservedCloseLedger} from '../../src/utils/observed-close-ledger';
import {portfolioStateAtDecisions} from '../../src/utils/portfolio-state-at-decisions';
const t=Date.now(),iso=(n:number)=>new Date(t+n).toISOString();
const seed=()=>({schema:'prospective-account-state-v1',source:'SELECT_only_repeatable_read',read_started_at:iso(0),known_at:iso(1),account:{id:1,symbol:'BTC',method_id:'kim_nghia',updated_at:iso(0),starting_balance:30,current_balance:30,equity:30,unrealized_pnl:0,realized_pnl:0,max_drawdown:0,accumulated_trading_fees:0,accumulated_funding_fee:0,total_trades:0,winning_trades:0,losing_trades:0,consecutive_losses:0,precision_error_count:0,last_trade_time:null,cooldown_until:null,precision_cooldown_until:null},positions:[],pending:[{order_id:'o',status:'pending'}]});
async function fixture(){
 const s:any=seed();s.read_started_at=iso(-1000);s.known_at=iso(-900);s.account.updated_at=iso(-1000);s.positions=[{position_id:'p',status:'open',side:'long',size_qty:1,entry_price:100,risk_usd:10,entry_time:iso(-2000)}];
 const result=await commitAtomicVerifiedClose({$transaction:async work=>work({testnetPosition:{updateMany:async()=>({count:1})},testnetAccount:{findUnique:async()=>({current_balance:30}),update:async()=>({})}})},{positionId:'p',accountId:1,closePrice:110,closeReason:'manual',realizedPnl:1,entryFee:.1,exitFee:.1,fundingFee:0,walletAuthoritative:true});
 if(result.status!=='committed')throw Error('fixture failed');
 const event={id:1,position_id:'p',event_type:'atomic_verified_close_committed',timestamp:new Date(Date.now()+1).toISOString(),event_data:result.receipt};return {s,event,cutoff:Date.now()+100};
}
it('joins an actual producer receipt once across inventory/account/ledger',async()=>{const {s,event,cutoff}=await fixture();expect(replayAtomicVerifiedClose(event.event_data,cutoff)).toMatchObject({status:'evaluated',matches_recorded:true});expect(projectSeededLocalMaterialization(s,[event],cutoff)).toMatchObject({positions:[{status:'closed',realized_pnl:1}],applied_event_ids:[1],current_full_state:null});expect(replayAccountOverwriteTimeline([event],cutoff,s).accounts[0].latest_observed_fields).toMatchObject({realized_pnl:1,total_trades:1,current_balance:30});expect(buildObservedCloseLedger([event],cutoff)).toMatchObject({observed_net_close_subtotal:1,economic_roi_base:null});});
it('withholds duplicate receipt identities rather than counting atomic net twice',async()=>{const {s,event,cutoff}=await fixture(),events=[event,{...event,id:2}];expect(buildObservedCloseLedger(events,cutoff).observed_net_close_subtotal).toBeNull();expect(projectSeededLocalMaterialization(s,events,cutoff).positions?.[0].status).toBe('open');expect(replayAccountOverwriteTimeline(events,cutoff,s).accounts[0].latest_observed_fields?.total_trades).toBe(0);});
it('rejects altered account projection and future commit clocks',async()=>{const {event,cutoff}=await fixture(),bad=structuredClone(event.event_data);bad.account_update.current_balance=31;expect(replayAtomicVerifiedClose(bad,cutoff)).toMatchObject({status:'evaluated',matches_recorded:false});expect(replayAtomicVerifiedClose(event.event_data,Date.parse(event.event_data.transaction_started_at)-1).status).toBe('unknown');expect(buildObservedCloseLedger([{...event,event_data:bad}],cutoff).observed_net_close_subtotal).toBeNull();});
it('keeps atomic account/inventory together before and after return, diagnosing overlapping reads from later evidence',async()=>{
 vi.useFakeTimers();
 try{
  const s:any=seed();s.pending=[];s.positions=[{position_id:'p',status:'open',side:'long',size_qty:1,entry_price:100,risk_usd:10,entry_time:iso(-100)}];
  vi.setSystemTime(t+10);
  const result=await commitAtomicVerifiedClose({$transaction:async work=>{const value=await work({testnetPosition:{updateMany:async()=>({count:1})},testnetAccount:{findUnique:async()=>({current_balance:30}),update:async()=>({})}});vi.setSystemTime(t+30);return value;}},{positionId:'p',accountId:1,closePrice:110,closeReason:'manual',realizedPnl:1,entryFee:.1,exitFee:.1,fundingFee:0,walletAuthoritative:true});
  if(result.status!=='committed')throw Error('fixture failed');
  const event={id:100,position_id:'p',event_type:'atomic_verified_close_committed',timestamp:iso(31),event_data:result.receipt};
  const read=(id:number,start:number,end:number)=>({id,event_type:'entry_trace',timestamp:iso(end),event_data:{stage:'symbol_exposure_evaluated',input:{read_started_at:iso(start),read_returned_at:iso(end)}}});
  const checkpoints=portfolioStateAtDecisions(s,[read(1,5,6),read(2,20,21),read(3,25,35),event,read(4,36,37)],t+40).checkpoints as any[];
  expect(checkpoints[0].overlapping_writes).toEqual([]);
  for(const c of checkpoints.slice(0,3)){expect(c.inventory.positions[0].status).toBe('open');expect(c.account.accounts[0].latest_observed_fields.total_trades).toBe(0);expect(c.prefix_event_ids).not.toContain(100);}
  for(const c of checkpoints.slice(1,3)){expect(c.unresolved).toContain('write_visibility_overlap:100');expect(c.overlapping_writes[0].publication_at).toBe(iso(31));}
  expect(checkpoints[3].inventory.positions[0].status).toBe('closed');expect(checkpoints[3].account.accounts[0].latest_observed_fields.total_trades).toBe(1);expect(checkpoints[3].overlapping_writes).toEqual([]);expect(checkpoints[3].current_full_state).toBeNull();
 }finally{vi.useRealTimers();}
});
