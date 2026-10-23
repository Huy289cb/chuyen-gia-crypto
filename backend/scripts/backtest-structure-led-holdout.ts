/** Evaluate frozen M5 lane on data not used for selecting it; no retuning here. */
import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {collectCoreAblations} from '../src/backtest/core-ablation';
import {boundStructureLedM5} from '../src/backtest/structure-led-m5-bounded';
import {selectStructureLedM5} from '../src/backtest/structure-led-m5';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const root=resolve('../docs/audits/2026-09-22-structure-led-m5/holdout-2022');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function main(){
 const freeze=read(join(root,'freeze.json')),parent=read('../docs/audits/2026-09-21-core-ablation/protocol.json');
 for(const [k,v] of Object.entries(parent.environment))process.env[k]=String(v);
 const hashes={...parent.sourceHashes,...Object.fromEntries(Object.entries(freeze.sourceHashes).map(([p,h])=>[resolve(p),h])),[__filename]:sha(__filename)};
 const check=()=>{for(const [p,h] of Object.entries(hashes))if(sha(p)!==h)throw Error('Frozen source changed: '+p);};check();
 const protocol={...freeze,freezeSha256:sha(join(root,'freeze.json')),sourceHashes:hashes,
  datasets:Object.keys(freeze.splits).map(id=>({id,...read(join(root,id+'-manifest.json'))})),
  promotionEligible:false};
 writeFileSync(join(root,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const d of protocol.datasets){
  if(sha(d.file)!==d.sha256)throw Error('Dataset changed');const data=read(d.file);
  const [start,end]=freeze.splits[d.id].map((s:string)=>Date.parse(s));
  const byTf=Object.fromEntries(Object.entries(data.byTf).filter(([tf])=>tf!=='1m').map(([tf,bars])=>[tf,(bars as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  const all=await collectCoreAblations(byTf,start,end,['current_core','without_5m_guard']);
  const m5=selectStructureLedM5(all.candidates.current_core,all.candidates.without_5m_guard);
  const bounded=boundStructureLedM5(m5,byTf,freeze.policy.minSlFraction);
  const candidates={current_core:all.candidates.current_core,structure_led_m5:m5,structure_led_m5_bounded:bounded.accepted};
  writeFileSync(join(root,d.id+'-bounded-rejections.json'),JSON.stringify(bounded.rejected));
  writeFileSync(join(root,d.id+'-candidates.json'),JSON.stringify({candidates,gateBlocks:all.blocks}));
  console.log(JSON.stringify({split:d.id,candidates:Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,v.length]))}));
  for(const slip of [.001,.002]){
   let baseline:ReturnType<typeof replayCoreCandidates>|undefined;
   for(const variant of ['current_core','structure_led_m5','structure_led_m5_bounded'] as const){
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates:candidates[variant],start,end,wallet:freeze.wallet,policy:freeze.policy,circuit:freeze.circuit,slippage:slip});
    if(variant==='current_core')baseline=result;
    const comparison=compareCoreCohorts(baseline!.closes,result.closes),cost=slip===.001?'base':'stress';
    const row={split:d.id,variant,cost,...result.summary,comparison};summaries.push(row);
    writeFileSync(join(root,`${d.id}-${variant}-${cost}.json`),JSON.stringify({...result,comparison},null,2));console.log(JSON.stringify(row));
   }
  }
 }
 check();writeFileSync(join(root,'summary.json'),JSON.stringify({protocol,summaries,promotionEligible:false},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
