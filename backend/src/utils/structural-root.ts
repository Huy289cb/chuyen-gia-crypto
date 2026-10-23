import { createHash } from 'node:crypto';
import { closedCandlesOnly, timeframeDurationMs } from './closed-candles';
import { findStructureSwings, type StructureCandle } from './structure-bias';
import type { WaveAnchorEvidence } from './setup-wave';

export interface StructuralRoot {
  version:'structural-range-root-v1'; id:string; symbol:string; timeframe:'4h';
  high:number; low:number; highOpen:number; lowOpen:number;
  highConfirmedAt:number; lowConfirmedAt:number; observedAt:number;
  expiredAt:number|null;
}

/** Measurement identity, independent of entries, returns, and provider decisions. */
export function observeStructuralRoot(candles:readonly (StructureCandle & {timestamp:number})[],
  symbol:string, asOf:number, graceMs=5000):StructuralRoot|null {
  if(!symbol || !Number.isFinite(asOf) || !Number.isFinite(graceMs) || graceMs<0)return null;
  const bars=closedCandlesOnly(candles,'4h',asOf,graceMs).slice(-100);
  if(bars.some((b,i)=>[b.timestamp,b.high,b.low].some(n=>!Number.isFinite(n)) || b.low<=0 || b.high<b.low || (i>0&&b.timestamp-bars[i-1].timestamp!==14400000)))return null;
  const swings=findStructureSwings(bars,2),high=swings.filter(s=>s.kind==='high').at(-1),low=swings.filter(s=>s.kind==='low').at(-1);
  if(!high||!low||high.price<=low.price||low.price<=0)return null;
  const duration=timeframeDurationMs('4h')!;
  const highConfirmedAt=bars[high.index+2].timestamp+duration+graceMs;
  const lowConfirmedAt=bars[low.index+2].timestamp+duration+graceMs;
  const highOpen=bars[high.index].timestamp,lowOpen=bars[low.index].timestamp;
  const id=createHash('sha256').update(JSON.stringify(['structural-range-root-v1',symbol.toUpperCase(),'4h',highOpen,lowOpen])).digest('hex');
  return {version:'structural-range-root-v1',id,symbol:symbol.toUpperCase(),timeframe:'4h',high:high.price,low:low.price,highOpen,lowOpen,highConfirmedAt,lowConfirmedAt,observedAt:asOf,expiredAt:null};
}

export function associateStructuralRoot(root:StructuralRoot|null,child:WaveAnchorEvidence,
  closedPrice:number,asOf:number) {
  const unknown=(reason:string)=>({status:'unknown' as const,reason,root_id:null,known_at:asOf});
  const duration=timeframeDurationMs(child.timeframe);
  if(!root)return unknown('no_confirmed_root');
  if(!/^[a-f0-9]{64}$/.test(root.id)||root.version!=='structural-range-root-v1'||root.timeframe!=='4h'||
    [root.high,root.low,root.highConfirmedAt,root.lowConfirmedAt,root.observedAt].some(n=>!Number.isFinite(n)||n<0)||
    root.low<=0||root.high<=root.low||(root.expiredAt!==null&&!Number.isFinite(root.expiredAt)))return unknown('invalid_root_evidence');
  if(!duration||!Number.isFinite(asOf)||!Number.isFinite(closedPrice)||closedPrice<=0||
    !['long','short'].includes(child.side)||!Number.isFinite(child.known_at)||
    !/^[a-f0-9]{64}$/.test(child.setup_id)||
    [child.high,child.low,child.high_open,child.low_open].some(n=>!Number.isFinite(n)||n<0)||
    child.low<=0||child.high<=child.low)return unknown('invalid_child_evidence');
  if(root.symbol!==child.symbol.toUpperCase())return unknown('different_symbol');
  if(root.observedAt>child.known_at||child.known_at>asOf||
    root.highConfirmedAt>child.known_at||root.lowConfirmedAt>child.known_at||
    Math.max(child.high_open,child.low_open)+duration>child.known_at)return unknown('future_or_unclosed_evidence');
  if(root.expiredAt!==null&&root.expiredAt<=asOf)return unknown('expired_root');
  if(child.high>root.high||child.low<root.low)return unknown('outside_structural_range');
  if((child.side==='long'&&closedPrice<root.low)||(child.side==='short'&&closedPrice>root.high))return unknown('directionally_invalidated');
  return {status:'linked' as const,reason:null,root_id:root.id,known_at:asOf};
}
