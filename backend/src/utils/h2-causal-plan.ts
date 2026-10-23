import {createHash} from 'node:crypto';
import {closedCandlesOnly} from './closed-candles';
import {findStructureSwings} from './structure-bias';
import {computeRegimeEvidence} from '../analyzers/market-regime.analyzer';
import type {H1Bar} from './h1-causal-plan';
export interface H2Candidate {id:string;side:'long'|'short';high:number;low:number;sweepExtreme:number;knownAt:number;expiresAt:number;highOpen:number;lowOpen:number}
/** Registered range sweep/reclaim feasibility prototype, not an order signal. */
export function h2Candidates(hour:H1Bar[],five:H1Bar[],asOf:number):H2Candidate[]{
 const h=closedCandlesOnly(hour,'1h',asOf,5000).slice(-100),b=closedCandlesOnly(five,'5m',asOf,5000).at(-1);
 if(h.length<50||!b||computeRegimeEvidence(h,{regimeBars:50,timeframe:'1h'}).regime!=='range')return [];
 const pivots=findStructureSwings(h,2),high=pivots.filter(p=>p.kind==='high').at(-1),low=pivots.filter(p=>p.kind==='low').at(-1);
 if(!high||!low||high.price<=low.price||b.close<=low.price||b.close>=high.price)return [];
 const out:H2Candidate[]=[];
 for(const side of ['long','short'] as const){if(!(side==='long'?b.low<low.price&&b.close>b.open:b.high>high.price&&b.close<b.open))continue;
  const highOpen=h[high.index].timestamp,lowOpen=h[low.index].timestamp,knownAt=b.timestamp+300000+5000;
  out.push({id:createHash('sha256').update(JSON.stringify(['h2-sweep-reclaim-v1',side,highOpen,lowOpen])).digest('hex'),side,high:high.price,low:low.price,sweepExtreme:side==='long'?b.low:b.high,knownAt,expiresAt:knownAt+90*60000,highOpen,lowOpen});
 }return out;
}
export function h2ReclaimPlan(c:H2Candidate,five:H1Bar[],asOf:number){
 if(asOf>=c.expiresAt)return {status:'expired' as const};
 const bars=closedCandlesOnly(five,'5m',asOf,5000),b=bars.at(-1);if(!b||b.timestamp<c.knownAt)return {status:'waiting' as const};
 const long=c.side==='long';if(long?b.close<c.sweepExtreme:b.close>c.sweepExtreme)return {status:'invalidated' as const};
 if(b.close<=c.low||b.close>=c.high)return {status:'range_lost' as const};
 if(bars.length<15)return {status:'missing_atr' as const};
 const tr=bars.slice(-14).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[bars.length-15+i].close),Math.abs(b.low-bars[bars.length-15+i].close))),atr=tr.reduce((a,b)=>a+b,0)/14;
 const entry=b.close,invalidation=long?Math.min(c.sweepExtreme,b.low):Math.max(c.sweepExtreme,b.high),stop=long?Math.min(invalidation-.25*atr,entry*.992):Math.max(invalidation+.25*atr,entry*1.008),target=long?c.high:c.low;
 return {status:'plan' as const,entry,stop,target,invalidation,atr,rr:Math.abs(target-entry)/Math.abs(entry-stop)};
}
