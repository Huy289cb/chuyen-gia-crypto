/** Pure descriptive analytics. Never chooses an order or treats recovery as proof of a better stop. */
export interface ObservationBar { openTime:number; open:number; high:number; low:number; close:number }
export interface ObservedTrade {
 id:string; side:'long'|'short'; entry:number; initialStop:number; target:number;
 entryTime:number; exitTime:number; exit:number; quantity:number; net:number; costs:number;
}
export const POST_EXIT_MINUTES=[15,60,240,720,1440,4320] as const;
export function analyzePostExit(p:ObservedTrade,bars:ObservationBar[],asOf:number){
 const d=p.side==='long'?1:-1,risk=Math.abs(p.entry-p.initialStop);
 if(![p.entry,p.initialStop,p.target,p.exit,p.quantity,risk].every(x=>Number.isFinite(x)&&x>0)||
  ![p.entryTime,p.exitTime,asOf,p.net,p.costs].every(Number.isFinite)||p.exitTime<p.entryTime||asOf<p.exitTime||
  d*(p.entry-p.initialStop)<=0||d*(p.target-p.entry)<=0)throw Error('invalid_observation');
 for(let i=0;i<bars.length;i++){
  const b=bars[i];if(![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0)||b.low>Math.min(b.open,b.close)||
   b.high<Math.max(b.open,b.close)||!Number.isInteger(b.openTime)||b.openTime%60000||
   (i>0&&b.openTime<=bars[i-1].openTime))throw Error('invalid_bars');
 }
 const describe=(from:number,to:number,reference:number)=>{
  const start=Math.ceil(from/60000)*60000,end=Math.floor(Math.min(to,asOf)/60000)*60000;
  const bs=bars.filter(b=>b.openTime>=start&&b.openTime+60000<=end);
  const expected=Math.max(0,(end-start)/60000);const continuous=bs.length===expected&&bs.every((b,i)=>b.openTime===start+i*60000);
  const favorable=(b:ObservationBar)=>d*((d===1?b.high:b.low)-reference);
  const adverse=(b:ObservationBar)=>-d*((d===1?b.low:b.high)-reference);
  const first=(level:number)=>{const b=bs.find(b=>d*((d===1?b.high:b.low)-level)>=0);return b?b.openTime:null;};
  const revisit=(level:number)=>{const b=bs.find(b=>reference<level?b.high>=level:reference>level?b.low<=level:b.low<=level&&b.high>=level);return b?b.openTime:null;};
  return {status:!continuous?'incomplete':asOf<to?'pending':'complete',expectedBars:expected,bars:bs.length,
   start,end,availableAt:asOf,partialBoundaryMinutesExcluded:true,
   mfeR:Math.max(0,...bs.map(favorable))/risk,maeR:Math.max(0,...bs.map(adverse))/risk,
   mfeUsd:Math.max(0,...bs.map(favorable))*p.quantity,maeUsd:Math.max(0,...bs.map(adverse))*p.quantity,
   returnToEntryAt:revisit(p.entry),reachOriginalTargetAt:first(p.target),
   // Recovery of already-incurred costs only; not a simulated re-entry breakeven.
   recoverIncurredCostsAt:first(p.entry+d*Math.max(0,p.costs)/p.quantity),
   favorableMilestones:Object.fromEntries([.5,1,1.5,2].map(r=>[r,first(p.entry+d*r*risk)]))};
 };
 return {version:'post-exit-v1.1',position:p,asOf,riskPrice:risk,priceBasis:'trade-price-1m',
  limits:'Full-minute extrema only; barrier touches are observations, not exchange trigger proof or executable counterfactual profit.',
  during:describe(p.entryTime,p.exitTime,p.entry),
  after:POST_EXIT_MINUTES.map(minutes=>({minutes,...describe(p.exitTime,p.exitTime+minutes*60000,p.exit)}))};
}
export type PostExitResult=ReturnType<typeof analyzePostExit>;
export function postExitLesson(r:PostExitResult,asOf:number):string|null {
 if(r.asOf>asOf||r.during.status!=='complete')return null;
 const complete=r.after.filter(w=>w.status==='complete'&&w.availableAt<=asOf);
 const w=complete.at(-1);
 return `${r.position.side} net ${r.position.net.toFixed(4)} USDT; full-minute pre-exit MFE ${r.during.mfeR.toFixed(2)}R / MAE ${r.during.maeR.toFixed(2)}R.`+
  (w?` After ${w.minutes}m: original target ${w.reachOriginalTargetAt===null?'not observed':'touched'}, entry level revisited ${w.returnToEntryAt===null?'not observed':'observed'}, further favorable/adverse move from exit ${w.mfeR.toFixed(2)}R/${w.maeR.toFixed(2)}R.`:' Post-exit horizons pending.')+
  ' Descriptive evidence only; recovery is not proof to widen SL or reverse direction.';
}
