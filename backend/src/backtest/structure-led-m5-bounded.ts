import {coreClosed,coreLevels,nearestCoreTarget,type CoreCandidate} from './core-ablation';
import type {BacktestCandle} from './types';
/** Structural geometry known at confirmation; missing targets are rejected, never invented. */
export function boundCoreCandidates(candidates:readonly CoreCandidate[],byTf:Record<string,BacktestCandle[]>,minSlFraction:number) {
  const accepted:CoreCandidate[]=[],rejected:Array<{id:string;reason:string}>=[];
  for(const c of candidates){
    const d=c.side==='long'?1:-1;
    const context=coreClosed(byTf[c.timeframe]??[],c.time,c.timeframe,6);
    const targets=['1h','4h'].map(tf=>nearestCoreTarget(coreClosed(byTf[tf],c.time,tf),c.side,c.entry))
      .filter((v):v is number=>v!==null).sort((a,b)=>d*(a-b));
    if(context.length<6||!targets.length){rejected.push({id:c.id,reason:'missing_structure'});continue;}
    // Target cannot exceed either nearest unswept barrier or the original 3R reference.
    const target=d===1?Math.min(c.takeProfit,targets[0]):Math.max(c.takeProfit,targets[0]);
    const invalidation=d===1?Math.min(...context.map(b=>b.low)):Math.max(...context.map(b=>b.high));
    const levels=coreLevels(c.side,c.entry,3,minSlFraction,target,invalidation,true);
    if(!levels){rejected.push({id:c.id,reason:'invalid_geometry'});continue;}
    accepted.push({...c,...levels});
  }
  return {accepted,rejected};
}

export function boundStructureLedM5(candidates:readonly CoreCandidate[],byTf:Record<string,BacktestCandle[]>,minSlFraction:number) {
  if(candidates.some(c=>c.timeframe!=='5m'))throw Error('expected_m5_candidates');
  return boundCoreCandidates(candidates,byTf,minSlFraction);
}
