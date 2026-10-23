/** Offline entry/exit hypotheses. No runtime configuration or order side effects. */
import {coreClosed,type CoreCandidate} from './core-ablation';
import type {BacktestCandle} from './types';

export function confirmedCoreRetests(candidates:readonly CoreCandidate[],byTf:Record<string,BacktestCandle[]>) {
  const accepted:CoreCandidate[]=[],rejected:Array<{id:string;reason:string}>=[];
  const bars=byTf['5m'];
  for(const candidate of candidates){
    const d=candidate.side==='long'?1:-1;
    const source=coreClosed(byTf[candidate.timeframe]??[],candidate.time,candidate.timeframe,1)[0];
    if(!source){rejected.push({id:candidate.id,reason:'missing_source'});continue;}
    // Freeze the middle of the signal candle's body; never choose a later low/high.
    const level=(source.open+source.close)/2;
    if(d*(candidate.entry-level)<=0||d*(level-candidate.stopLoss)<=0){
      rejected.push({id:candidate.id,reason:'no_valid_pullback_level'});continue;
    }
    const future=bars.filter(b=>b.timestamp>=candidate.time&&b.timestamp+300000<=candidate.time+3600000);
    let touched=false,reason='no_confirmed_retest';
    for(const b of future){
      if(d===1?b.low<=candidate.stopLoss:b.high>=candidate.stopLoss){reason='stop_invalidated';break;}
      if(d===1?b.high>=candidate.takeProfit:b.low<=candidate.takeProfit){reason='target_consumed';break;}
      if(d===1?b.low<=level:b.high>=level)touched=true;
      if(!touched||d*(b.close-level)<=0||d*(b.close-b.open)<=0||d*(candidate.entry-b.close)<=0)continue;
      const entry=Math.round(b.close*10)/10;
      // Preserve the old invalidation, extending only as required by the unchanged 0.8% floor.
      const raw=d===1?Math.min(candidate.stopLoss,entry*(1-.008)):Math.max(candidate.stopLoss,entry*(1+.008));
      const stopLoss=(d===1?Math.floor(raw*10):Math.ceil(raw*10))/10;
      accepted.push({...candidate,time:b.timestamp+300000,entry,stopLoss});reason='accepted';break;
    }
    if(reason!=='accepted')rejected.push({id:candidate.id,reason});
  }
  accepted.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  return {accepted,rejected};
}

/** Exit price covering costs accrued so far; future funding/gaps can still cause a loss. */
export function costCoveredStop(input:{side:'long'|'short';entry:number;quantity:number;entryFee:number;entrySlip:number;
  funding:number;feePerSide:number;roundTripSlippage:number}) {
  const {entry,quantity,entryFee,entrySlip,funding,feePerSide,roundTripSlippage}=input;
  if(![entry,quantity].every(v=>Number.isFinite(v)&&v>0)||
    ![entryFee,entrySlip,feePerSide,roundTripSlippage].every(v=>Number.isFinite(v)&&v>=0)||
    !Number.isFinite(funding)||feePerSide>=1)throw Error('invalid_cost_stop');
  const d=input.side==='long'?1:-1;
  const price=(d*entry*quantity+entryFee+entrySlip+funding+entry*quantity*roundTripSlippage/2)/(quantity*(d-feePerSide));
  // One favorable tick beyond the theoretical cash breakeven.
  return (d===1?Math.ceil(price*10)+1:Math.floor(price*10)-1)/10;
}
