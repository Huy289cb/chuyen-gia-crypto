import {it,expect} from 'vitest';
import {associateSetupWave,type WaveAnchorEvidence} from '../../src/utils/setup-wave';
const parent:WaveAnchorEvidence={setup_id:'a'.repeat(64),symbol:'BTC',side:'long',timeframe:'15m',high:110,low:90,high_open:0,low_open:900000,known_at:1805000};
const child:WaveAnchorEvidence={...parent,setup_id:'b'.repeat(64),timeframe:'5m',high_open:300000,low_open:1200000,known_at:2105000};
it('links observed identical boundaries across frames with a causal parent',()=>{
 const r=associateSetupWave(parent,child,2200000);expect(r.status).toBe('linked');expect(r.known_at).toBe(child.known_at);
 expect(associateSetupWave(parent,{...child,setup_id:'c'.repeat(64)},2200000).wave_id).toBe(r.wave_id);
});
it('does not retrospectively link a parent learned later or collapse nearby unrelated setups',()=>{
 for(const [p,c] of [[{...parent,known_at:2200000},child],[parent,{...child,high:111}],
 [parent,{...child,high_open:900000}],[parent,{...child,side:'short' as const}],
 [parent,{...child,known_at:2300000}]] as [WaveAnchorEvidence,WaveAnchorEvidence][]){
  const r=associateSetupWave(p,c,2200000);expect(r.status).toBe('unknown');expect(r.wave_id).toBeNull();
 }
});
