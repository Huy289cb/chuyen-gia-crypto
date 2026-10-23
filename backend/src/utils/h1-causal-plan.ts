import {createHash} from 'node:crypto';
import {findStructureSwings} from './structure-bias';
import {closedCandlesOnly} from './closed-candles';
export interface H1Bar {timestamp:number;open:number;high:number;low:number;close:number;volume:number}
export interface H1Candidate {id:string;side:'long'|'short';level:number;pivotOpen:number;knownAt:number;expiresAt:number}
/** Feasibility prototype, not entry authorization. */
export function h1Candidates(hour:H1Bar[],asOf:number):H1Candidate[]{
 const bars=closedCandlesOnly(hour,'1h',asOf,5000).slice(-100);if(bars.length<5)return [];
 const first=bars.at(-2)!,last=bars.at(-1)!,pivots=findStructureSwings(bars.slice(0,-2),2),out:H1Candidate[]=[];
 for(const side of ['long','short'] as const){const p=pivots.filter(p=>p.kind===(side==='long'?'high':'low')).at(-1);if(!p)continue;
  if(!(side==='long'?first.close>p.price&&last.close>p.price:first.close<p.price&&last.close<p.price))continue;
  const pivotOpen=bars[p.index].timestamp,knownAt=last.timestamp+3600000+5000;
  out.push({id:createHash('sha256').update(JSON.stringify(['h1-accept-retest-v1',side,pivotOpen])).digest('hex'),side,level:p.price,pivotOpen,knownAt,expiresAt:knownAt+45*60000});
 }return out;
}
export function h1RetestPlan(candidate:H1Candidate,fifteen:H1Bar[],fourHour:H1Bar[],asOf:number){
 const bars=closedCandlesOnly(fifteen,'15m',asOf,5000),bar=bars.at(-1);
 if(asOf>=candidate.expiresAt)return {status:'expired' as const};
 if(!bar||bar.timestamp<candidate.knownAt)return {status:'waiting' as const};
 const long=candidate.side==='long',level=candidate.level;
 if(long?bar.close<level*(1-.0025):bar.close>level*(1+.0025))return {status:'invalidated' as const};
 if(!(long?bar.low<=level*1.0015&&bar.close>=level:bar.high>=level*.9985&&bar.close<=level))return {status:'waiting' as const};
 if(bars.length<15)return {status:'missing_atr' as const};
 const ranges=bars.slice(-14).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[bars.length-15+i].close),Math.abs(b.low-bars[bars.length-15+i].close))),atr=ranges.reduce((a,b)=>a+b,0)/14;
 const entry=bar.close,invalidation=long?Math.min(level,bar.low):Math.max(level,bar.high),stop=long?Math.min(invalidation-atr*.25,entry*.992):Math.max(invalidation+atr*.25,entry*1.008);
 const parent=closedCandlesOnly(fourHour,'4h',asOf,5000),swings=findStructureSwings(parent,2);
 const targets=swings.filter(p=>p.kind===(long?'high':'low')&&(long?p.price>entry:p.price<entry)).filter(p=>!parent.slice(p.index+3).some(b=>long?b.high>=p.price:b.low<=p.price)).sort((a,b)=>long?a.price-b.price:b.price-a.price);
 const target=targets[0];if(!target)return {status:'target_unknown' as const,entry,stop,invalidation,atr};
 return {status:'plan' as const,entry,stop,invalidation,atr,target:target.price,targetPivotOpen:parent[target.index].timestamp,targetKnownAt:parent[target.index+2].timestamp+14400000+5000,rr:Math.abs(target.price-entry)/Math.abs(entry-stop)};
}
