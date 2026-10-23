/** Research-only single-pending/single-position adapter. Admission is rechecked at assumed fill. */
import {ReplayAccount,type ReplayAccountOptions} from '../src/backtest/replay-account';
type Candidate={id:string;side:'long'|'short';confirmedAt:number;entry:number;stopLoss:number};
type Outcome={id:string;state:string;fillAt:number|null;exitAt:number|null;exitPrice?:number};
export function runIctTimeline(candidates:Candidate[],outcomes:Outcome[],options:ReplayAccountOptions){
 const byId=new Map(candidates.map(c=>[c.id,c]));if(byId.size!==candidates.length)throw Error('duplicate candidate');
 if(outcomes.length!==candidates.length||new Set(outcomes.map(r=>r.id)).size!==outcomes.length)throw Error('outcome cardinality');
 const events:{time:number;kind:'create'|'expire'|'fill'|'exit';id:string;price?:number}[]=[];
 for(const r of outcomes){const c=byId.get(r.id);if(!c)throw Error('missing candidate');
  if(!['expired_without_fill','closed_assumed_fill'].includes(r.state))throw Error('unresolved outcome blocks portfolio evaluation: '+r.state);
  const start=c.confirmedAt+1;events.push({time:start,kind:'create',id:c.id});
  if(r.state==='expired_without_fill')events.push({time:start+3600000,kind:'expire',id:c.id});
  else {if(r.fillAt===null||r.exitAt===null||r.fillAt<start+60000||r.fillAt>=start+3600000||r.exitAt<=r.fillAt||!Number.isFinite(r.exitPrice))throw Error('invalid outcome times/price');
   // Funding within an ambiguous fill/exit minute must be resolved before account replay.
   if(options.funding.some(f=>(f.time>=r.fillAt!&&f.time<r.fillAt!+60000)||(f.time>=r.exitAt!&&f.time<r.exitAt!+60000)))throw Error('funding order ambiguous');
   events.push({time:r.fillAt,kind:'fill',id:c.id},{time:r.exitAt,kind:'exit',id:c.id,price:r.exitPrice});}
 }
 const rank={exit:0,expire:1,create:2,fill:3};events.sort((a,b)=>a.time-b.time||rank[a.kind]-rank[b.kind]||a.id.localeCompare(b.id));
 const ledger=new ReplayAccount(options);let pending:string|null=null,holding:string|null=null,blockedUntil=0,blockedReason='post_close_cooldown';const log:any[]=[];
 for(const e of events){ledger.advance(e.time);const c=byId.get(e.id)!;
  if(e.kind==='create'){
   const reason=holding?'open_position':pending?'pending_order':e.time<blockedUntil?blockedReason:null;
   if(reason){log.push({...e,state:'blocked',reason});continue;}pending=e.id;log.push({...e,state:'pending'});
  }else if(e.kind==='expire'&&pending===e.id){pending=null;blockedUntil=e.time+60*60000;blockedReason='pending_reentry_cooldown';log.push({...e,state:'expired'});
  }else if(e.kind==='fill'&&pending===e.id){pending=null;const admission=ledger.tryOpen({key:c.id,side:c.side,entry:c.entry,stopLoss:c.stopLoss,time:e.time});
   if(admission.accepted){holding=e.id;log.push({...e,state:'filled',quantity:admission.quantity});}else log.push({...e,state:'rejected',reason:admission.reason});
  }else if(e.kind==='exit'&&holding===e.id){const close=ledger.close(c.id,e.price!,e.time);holding=null;blockedUntil=e.time+60*60000;blockedReason='post_close_cooldown';log.push({...e,state:'closed',...close});}
 }
 return {initialWallet:options.initialWallet,wallet:ledger.wallet,netUsd:ledger.wallet-options.initialWallet,log,closedTrades:log.filter(e=>e.state==='closed').length,pending,holding,limits:['Research admission at fill; not full live guard parity','Same-time ordering is a declared simulation convention','Notional filters .001 BTC / 50 USD inherited from ReplayAccount','No counterfactual baseline portfolio reconstruction']};
}
