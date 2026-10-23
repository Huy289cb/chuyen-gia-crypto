import type {ObservationBar} from './post-exit-analysis';
export interface FundingObservation {fundingTime:number;fundingRate:string;markPrice:string}
/** Paired fixed-level hypothetical paths. No claim of live fills, admission or portfolio ROI. */
export function observeRangeMirror(input:{entry:number;stop:number;target:number;time:number;asOf:number;bars:ObservationBar[];funding:FundingObservation[]}){
 const {entry,stop,target,time,asOf,bars,funding}=input;
 if(!(stop>0&&stop<entry&&entry<target)||![time,asOf].every(Number.isFinite))throw Error('invalid_range');
 const start=Math.ceil(time/60000)*60000,deadline=start+72*3600000,end=Math.min(deadline,Math.floor(asOf/60000)*60000);
 const bs=bars.filter(b=>b.openTime>=start&&b.openTime<end);
 if(bs.length!==Math.max(0,(end-start)/60000)||!bs.every((b,i)=>b.openTime===start+i*60000))return {status:'incomplete' as const,paths:[]};
 const paths=([1,-1] as const).map(d=>{
  const sl=d===1?stop:2*entry-stop,tp=d===1?target:2*entry-target;
  let reason=asOf>=deadline?'time_exit':'pending',exit=bs.at(-1)?.close??entry,exitTime=end,ambiguous=false;
  for(const b of bs){const s=d===1?b.low<=sl:b.high>=sl,t=d===1?b.high>=tp:b.low<=tp;
   if(s||t){reason=s?'sl':'tp';exit=s?(d===1?Math.min(b.open,sl):Math.max(b.open,sl)):tp;exitTime=b.openTime;ambiguous=s&&t;break;}}
  const quantity=.001,fee=(entry+exit)*quantity*.0005;
  const fundingCash=funding.reduce((sum,f)=>{const cash=-d*quantity*Number(f.markPrice)*Number(f.fundingRate);
   return sum+(f.fundingTime>time&&(f.fundingTime<exitTime||(f.fundingTime<exitTime+60000&&cash<0))?cash:0);},0);
  const gross=d*(exit-entry)*quantity;
  return {side:d===1?'long':'short',reason,exit,exitTime,ambiguous,quantity,
   baseNet:reason==='pending'?null:gross-fee-entry*quantity*.001+fundingCash,
   stressNet:reason==='pending'?null:gross-fee-entry*quantity*.002+fundingCash,
   minimumLotRiskUsd:Math.abs(sl-entry)*quantity+(entry+sl)*quantity*.0005+entry*quantity*.002};
 });
 return {status:'observed' as const,paths,limits:'Conditional same entry at 0.001 BTC; fixed barriers, no AI/admission/portfolio simulation; excludes entry partial minute. Trade-price proxy.'};
}
