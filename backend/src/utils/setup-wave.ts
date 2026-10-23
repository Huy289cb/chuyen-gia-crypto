import { createHash } from 'node:crypto';
import { timeframeDurationMs } from './closed-candles';

export interface WaveAnchorEvidence {
  setup_id:string; symbol:string; side:'long'|'short'; timeframe:string;
  high:number; low:number; high_open:number; low_open:number;
  // Persisted observation time, not retrospectively inferred detection time.
  known_at:number;
}
/** Conservative structural association, not a claim that every unmatched setup is independent. */
export function associateSetupWave(parent:WaveAnchorEvidence, child:WaveAnchorEvidence, asOf:number) {
  const unknown=(reason:string)=>({status:'unknown' as const,reason,wave_id:null,parent_setup_id:null,child_setup_id:child.setup_id,known_at:null});
  const pd=timeframeDurationMs(parent.timeframe),cd=timeframeDurationMs(child.timeframe);
  if(!Number.isFinite(asOf)||!pd||!cd||pd<=cd) return unknown('invalid_parent_timeframe');
  for(const item of [parent,child]){
    if(!/^[a-f0-9]{64}$/.test(item.setup_id)||!item.symbol||!['long','short'].includes(item.side)||
      [item.high,item.low,item.high_open,item.low_open,item.known_at].some(n=>!Number.isFinite(n)||n<0)||
      item.low<=0||item.high<=item.low||item.known_at>asOf) return unknown('missing_or_future_evidence');
    const duration=item===parent?pd:cd;
    if(Math.max(item.high_open,item.low_open)+duration>item.known_at) return unknown('unclosed_anchor');
  }
  if(parent.known_at>child.known_at) return unknown('parent_unknown_at_child_observation');
  if(parent.symbol.toUpperCase()!==child.symbol.toUpperCase()||parent.side!==child.side) return unknown('different_symbol_or_side');
  if(parent.high!==child.high||parent.low!==child.low) return unknown('different_structural_boundaries');
  if(child.high_open<parent.high_open||child.high_open>=parent.high_open+pd||
    child.low_open<parent.low_open||child.low_open>=parent.low_open+pd) return unknown('different_anchor_bars');
  return {status:'linked' as const,reason:null,
    wave_id:createHash('sha256').update(JSON.stringify(['exact-anchor-wave-v1',parent.setup_id])).digest('hex'),
    parent_setup_id:parent.setup_id,child_setup_id:child.setup_id,known_at:child.known_at};
}
