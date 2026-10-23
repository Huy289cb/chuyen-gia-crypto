/** Existing entry gates that do not need AI-generated levels. Always recheck after AI as well. */
import {evaluateHtfTrendRequirement,evaluateSetupGradePlaybookFilter,getV3RequireHtfTrend,getV3HtfTrendAlt,isRangeEntryBlocked} from '../config/v3-entry-policy';
import {shouldBypassRegimeForBreakout} from '../config/v3-regime-policy';

export function evaluatePreAiEntryGates(input:{
  optimizedRangeRetest:boolean;timeframe:string;gateRegime:string;grade:string;confidence:number;
  playbookKey:string|null;playbookSide:'long'|'short'|null;
  scanState:(tf:string)=>{fresh:boolean;regime:string;reason?:string};
}):{pass:boolean;gate?:'regime'|'htf'|'grade_playbook';reason?:string}{
  // The separate range policy already revalidates its own constraints.
  if(input.optimizedRangeRetest)return {pass:true};
  if(isRangeEntryBlocked(input.gateRegime))return {pass:false,gate:'regime',reason:`Regime ${input.gateRegime} blocked for entries (V3_BLOCK_RANGE_ENTRIES)`};
  const grade=['A','B','C','D'].includes(input.grade)?input.grade as 'A'|'B'|'C'|'D':'D';
  const bypass=shouldBypassRegimeForBreakout(input.timeframe,input.playbookKey,grade)&&input.playbookSide==='long';
  const primaryTf=getV3RequireHtfTrend();
  if(primaryTf&&!bypass){
    const primary=input.scanState(primaryTf);
    if(!primary.fresh)return {pass:false,gate:'htf',reason:primary.reason??`HTF ${primaryTf} scan unavailable`};
    const altTf=getV3HtfTrendAlt();let altRegime:string|undefined,altReason:string|undefined;
    if(altTf&&primary.regime!=='trend'){
      const alt=input.scanState(altTf);altRegime=alt.fresh?alt.regime:'unknown';
      if(!alt.fresh)altReason=alt.reason??`HTF ${altTf} scan unavailable`;
    }
    const result=evaluateHtfTrendRequirement({entryTimeframe:input.timeframe,primaryTf,primaryRegime:primary.regime,altTf,altRegime});
    if(!result.pass)return {pass:false,gate:'htf',reason:altReason??result.reason??'HTF trend blocked'};
  }
  const filter=evaluateSetupGradePlaybookFilter({grade:input.grade,confidence:input.confidence,playbookKey:input.playbookKey});
  return filter.pass?{pass:true}:{pass:false,gate:'grade_playbook',reason:filter.reason??'grade/playbook filter blocked entry'};
}
