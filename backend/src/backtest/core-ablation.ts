import { volatilityScaledRegime } from './volatility-scaled-regime';
/** Offline core-policy experiment. No DB, exchange, provider or order imports. */
import { SignalGateService } from '../services/signal-gate.service';
import { getRiskPolicy } from '../config/risk-policy';
import * as entryPolicy from '../config/v3-entry-policy';
import * as structurePolicy from '../config/v3-structure-bias-policy';
import { getV3SignalGateTimeframes } from '../config/v3-schedulers';
import { shouldBypassRegimeForBreakout } from '../config/v3-regime-policy';
import { computeRegimeEvidence } from '../analyzers/market-regime.analyzer';
import { getSignalGateWindows, getSignalGateCandleLimit } from '../config/signal-gate-windows';
import { compareSignalGateForEntry } from '../utils/signal-gate-ranking';
import { inferSetupTradeSide } from '../utils/setup-trade-side';
import { findStructureSwings } from '../utils/structure-bias';
import { buildIctH1Structure, ictStructureAt, type IctStructurePoint } from '../utils/ict-research';
import type { BacktestCandle } from './types';

export const CORE_ABLATIONS = ['current_core', 'without_structure', 'without_bos', 'without_side_align',
  'without_pullback', 'without_5m_guard', 'grade_b70', 'rr2', 'rr15', 'protected_h1',
  'structural_exit', 'july_rule_proxy'] as const;
export type CoreAblation = typeof CORE_ABLATIONS[number];
export interface CoreCandidate {
  id: string; time: number; timeframe: string; side: 'long' | 'short'; setup: string;
  entry: number; stopLoss: number; takeProfit: number; targetBound: number;
}
const durations: Record<string, number> = {'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
/** Bounded closed history; prefix-invariant, no partially formed higher timeframe bars. */
export function coreClosed(rows: BacktestCandle[], time: number, tf: string, limit = 120): BacktestCandle[] {
  let lo=0,hi=rows.length;
  while(lo<hi){const m=(lo+hi)>>>1;if(rows[m].timestamp+durations[tf]<=time)lo=m+1;else hi=m;}
  return rows.slice(Math.max(0,lo-limit),lo);
}
export function nearestCoreTarget(rows: BacktestCandle[], side: 'long'|'short', entry: number): number | null {
  const d=side==='long'?1:-1;
  const targets=findStructureSwings(rows,2).filter(p=>p.kind===(d===1?'high':'low')&&d*(p.price-entry)>0&&
    !rows.slice(p.index+3).some(b=>d===1?b.high>=p.price:b.low<=p.price)).map(p=>p.price);
  return targets.length ? (d===1?Math.min(...targets):Math.max(...targets)) : null;
}
export function coreLevels(side:'long'|'short',entry:number,rr:number,floor:number,
  target:number|null, invalidation:number|null, structural:boolean) {
  const d=side==='long'?1:-1;
  const distance=structural&&invalidation!==null?Math.max(entry*floor,d*(entry-invalidation)+.1):entry*floor;
  const stop=(d===1?Math.floor((entry-distance)*10):Math.ceil((entry+distance)*10))/10;
  const tp=structural?target:Math.round((entry+d*Math.abs(entry-stop)*rr)*10)/10;
  if(tp===null||d*(tp-entry)<=0||stop<=0)return null;
  return {stopLoss:stop,takeProfit:tp,targetBound:tp};
}
export async function collectCoreAblations(byTf:Record<string,BacktestCandle[]>,start:number,end:number,
  variants: readonly CoreAblation[]=CORE_ABLATIONS, regimeMode: 'current'|'volatility_scaled'='current') {
  const risk=getRiskPolicy(),timeframes=getV3SignalGateTimeframes();
  const h1=buildIctH1Structure(byTf['1h']);
  const gate=new SignalGateService({minGrade:'B',minConfidence:.7,allowedRegimes:entryPolicy.getSignalGateAllowedRegimes(),enableDuplicateFilter:false}, regimeMode==='volatility_scaled' ? input=>volatilityScaledRegime(input.candles,input.timeframe) : undefined);
  const candidates=Object.fromEntries(variants.map(v=>[v,[] as CoreCandidate[]])) as Record<CoreAblation,CoreCandidate[]>;
  const blocks=Object.fromEntries(variants.map(v=>[v,{} as Record<string,number>])) as Record<CoreAblation,Record<string,number>>;
  const seen=Object.fromEntries(variants.map(v=>[v,new Set<string>()])) as Record<CoreAblation,Set<string>>;
  const count=(v:CoreAblation,k:string)=>{blocks[v][k]=(blocks[v][k]??0)+1;};
  let steps=0;
  for(const bar of byTf['5m']){
    const time=bar.timestamp+300000;
    if(time<=start||time>=end)continue;
    steps++;
    const history=(tf:string,n=120)=>coreClosed(byTf[tf]??[],time,tf,n);
    const state=(tf:string)=>{
      const rows=history(tf);if(rows.length<50)return {regime:null,trendDirection:null};
      return regimeMode==='volatility_scaled' ? volatilityScaledRegime(rows,tf) : computeRegimeEvidence(rows,{regimeBars:getSignalGateWindows(tf).regimeBars,timeframe:tf});
    };
    const htfTf=entryPolicy.getV3LtfAlignRegimeHtf()??entryPolicy.getV3RequireHtfTrend()??'1h';
    const primary=state(htfTf), s1=state('1h'),s15=state('15m');
    const evaluations=[];
    for(const tf of timeframes){
      const rows=history(tf,getSignalGateCandleLimit(tf));if(rows.length<50)continue;
      const result=await gate.evaluate({candles:rows,symbol:'BTC',timeframe:tf,htfRegime:tf!==htfTf?primary.regime:undefined});
      evaluations.push({timeframe:tf,result,candles:rows});
    }
    for(const v of variants){
      const relaxed=v==='grade_b70';
      const pass=evaluations.filter(e=>e.result.pass&&(relaxed||
        ((risk.minSignalGrade!=='A'||e.result.setupResult.grade==='A')&&e.result.setupResult.confidence>=risk.minSignalConfidence)));
      pass.sort(compareSignalGateForEntry);
      const pick=pass[0];if(!pick){count(v,'signal_gate');continue;}
      const setup=pick.result.setupResult,key=`${pick.timeframe}:${setup.evidence.lastCandleTime??time}`;
      if(seen[v].has(key)){count(v,'duplicate');continue;}seen[v].add(key);
      const regime=pick.result.gateRegime??setup.regime;
      if(entryPolicy.isRangeEntryBlocked(regime)){count(v,'regime');continue;}
      const side=inferSetupTradeSide(setup,pick.timeframe,pick.candles);
      if(!side){count(v,'direction');continue;}
      const impulse=shouldBypassRegimeForBreakout(pick.timeframe,setup.playbookKey,setup.grade)&&side==='long';
      const required=entryPolicy.getV3RequireHtfTrend(),alt=entryPolicy.getV3HtfTrendAlt();
      if(required&&!impulse&&!entryPolicy.evaluateHtfTrendRequirement({entryTimeframe:pick.timeframe,
        primaryTf:required,primaryRegime:state(required).regime,altTf:alt??undefined,altRegime:alt?state(alt).regime:undefined}).pass){count(v,'htf');continue;}
      const legacy=v==='july_rule_proxy';
      const struct=structurePolicy.evaluateStructureSidePermission({side,candles:history(structurePolicy.getV3StructureBiasTf(),structurePolicy.getV3StructureBiasCandleLimit()),
        enabled:legacy||v==='without_structure'||v==='protected_h1'?false:undefined,
        longRequireBos:v==='without_bos'?false:undefined,shortRequireBos:v==='without_bos'?false:undefined});
      if(!struct.pass){count(v,'structure');continue;}
      if(v==='protected_h1'&&ictStructureAt(h1,time-1)?.side!==side){count(v,'protected_h1');continue;}
      const alignTf=entryPolicy.getV3HtfSideAlignTf();
      if(!entryPolicy.evaluateHtfSideAlign({side,htfTf:alignTf,htf:state(alignTf),
        structureBias:v==='protected_h1'?(side==='long'?'bull':'bear'):struct.bias,
        enabled:legacy||v==='without_side_align'?false:undefined}).pass){count(v,'side_align');continue;}
      if(!entryPolicy.evaluateSetupGradePlaybookFilter({grade:setup.grade,confidence:setup.confidence,playbookKey:setup.playbookKey,
        minGrade:relaxed?'B':undefined,gradeBMinConfidence:relaxed ? .7 : undefined}).pass){count(v,'grade_playbook');continue;}
      if(v!=='without_5m_guard'&&!entryPolicy.evaluate5mEntryGuards({entryTimeframe:pick.timeframe,side,tf1h:s1,tf15m:s15}).pass){count(v,'5m_guard');continue;}
      if(!legacy&&v!=='without_pullback'&&entryPolicy.isV3RequirePullback()){
        const tf=entryPolicy.getV3PullbackTf();
        if(!entryPolicy.evaluateTrendPullbackEntry({side,entry:bar.close,closes:history(tf).map(b=>b.close),smaPeriod:entryPolicy.getV3PullbackSmaPeriod(),
          maxAbovePct:impulse?entryPolicy.getV3BreakoutPullbackMaxAbovePct():entryPolicy.getV3PullbackMaxAbovePct(),
          maxBelowPct:entryPolicy.getV3PullbackMaxBelowPct(),tfLabel:tf}).pass){count(v,'pullback');continue;}
      }
      const d=side==='long'?1:-1,targets=['1h','4h'].map(tf=>nearestCoreTarget(history(tf),side,bar.close)).filter((p):p is number=>p!==null).sort((a,b)=>d*(a-b));
      const invalidation=side==='long'?Math.min(...pick.candles.slice(-6).map(b=>b.low)):Math.max(...pick.candles.slice(-6).map(b=>b.high));
      const levels=coreLevels(side,bar.close,v==='rr15'?1.5:v==='rr2'||legacy?2:3,risk.minSlDistancePercent,targets[0]??null,invalidation,v==='structural_exit');
      if(!levels){count(v,'target_missing');continue;}
      candidates[v].push({id:`${key}:${side}`,time,timeframe:pick.timeframe,side,setup:setup.playbookKey??'unknown',entry:bar.close,...levels});
    }
  }
  return {steps,candidates,blocks,h1};
}
export type CoreStructure = IctStructurePoint[];
