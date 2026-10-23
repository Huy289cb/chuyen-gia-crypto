import {createHash} from 'node:crypto';
export interface CausalPlanContract {
 version:'h1-h2-review-v1';setupId:string;mechanism:'H1'|'H2';symbol:'BTC';
 timeframe:'15m'|'5m';side:'long'|'short';knownAt:number;expiresAt:number;
 entry:number;stop:number;target:number;invalidation:number;minRr:number;hash:string;
}
function digest(p:Omit<CausalPlanContract,'hash'>):string {
 return createHash('sha256').update(JSON.stringify([p.version,p.setupId,p.mechanism,p.symbol,p.timeframe,p.side,p.knownAt,p.expiresAt,p.entry,p.stop,p.target,p.invalidation,p.minRr])).digest('hex');
}
export function sealCausalPlan(p:Omit<CausalPlanContract,'hash'>):CausalPlanContract{return {...p,hash:digest(p)};}
export function causalPlanBlock(p:CausalPlanContract,symbol:string,timeframe:string,now:number):string|null {
 if(p.version!=='h1-h2-review-v1'||!p.setupId||p.hash!==digest(p)||p.symbol!=='BTC'||symbol!==p.symbol||timeframe!==p.timeframe||
  !['H1','H2'].includes(p.mechanism)||p.timeframe!==(p.mechanism==='H1'?'15m':'5m')||!['long','short'].includes(p.side))return 'causal_plan_identity_changed';
 if(![now,p.knownAt,p.expiresAt].every(Number.isFinite)||p.knownAt>now||now>=p.expiresAt||p.expiresAt<=p.knownAt)return 'causal_plan_expired_or_future';
 if(![p.entry,p.stop,p.target,p.invalidation,p.minRr].every(v=>Number.isFinite(v)&&v>0)||p.minRr!==1.5)return 'causal_plan_geometry_invalid';
 const d=p.side==='long'?1:-1;
 if(d*(p.entry-p.stop)<=0||d*(p.target-p.entry)<=0||d*(p.entry-p.invalidation)<0||d*(p.invalidation-p.stop)<0)return 'causal_plan_geometry_invalid';
 return null;
}
export function causalAnalysisBlock(p:CausalPlanContract,a:{action:string;suggested_entry?:number;suggested_stop_loss?:number;suggested_take_profit?:number;invalidation_level?:number}):string|null {
 if(a.action==='hold')return null;
 return a.action===(p.side==='long'?'buy':'sell')&&a.suggested_entry===p.entry&&a.suggested_stop_loss===p.stop&&
  a.suggested_take_profit===p.target&&a.invalidation_level===p.invalidation?null:'causal_plan_review_changed';
}
export function causalPlanPrompt(p:CausalPlanContract):string {
 return '\nIMMUTABLE CAUSAL PLAN: '+JSON.stringify(p)+'\nReview this exact plan. Return hold to veto, or the stated buy/sell side with exact entry, stop_loss, take_profit and invalidation_level in the existing response schema. Do not repair or move levels. Confidence must be your own assessment. All entry guards still apply.';
}
