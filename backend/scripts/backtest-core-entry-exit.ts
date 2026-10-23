/** One predeclared 2x2 experiment, reusing frozen core candidates. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {confirmedCoreRetests} from '../src/backtest/core-entry-exit';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const prior=resolve('../docs/audits/2026-09-21-core-ablation');
const out=resolve('../docs/audits/2026-09-23-entry-exit');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const variants=['baseline','confirmed_retest','cost_protection','retest_protection'] as const;
function main(){
 mkdirSync(out,{recursive:true});const parent=read(join(prior,'protocol.json'));
 const paths=[__filename,...['core-entry-exit','core-ablation-replay','core-ablation','opportunity-portfolio'].map(f=>resolve('src/backtest/'+f+'.ts')),
  resolve('src/utils/ai-opportunity.ts'),resolve('src/utils/execution-risk.ts'),resolve('src/utils/ict-research.ts')];
 const hashes=Object.fromEntries(paths.map(p=>[p,sha(p)]));
 const protocol={version:'core-entry-exit-v1',frozenAt:new Date().toISOString(),variants,datasets:parent.datasets,
  wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,costs:parent.costs,sourceHashes:hashes,
  hypothesis:'Retest body midpoint of closed signal candle within60m; must touch and close a bullish/bearish5m candle back beyond midpoint at better price. Entry is confirmation close with existing replay latency/TTL; original stop retained or extended to preserve0.8%floor, original TP unchanged. Cost protection: only after5m close >=1R, tighten stop to accrued cash breakeven+one favorable tick for later minutes.',
  motivation:'Baseline trajectory:6/20 losses had at least1R favorable excursion in fully contained pre-exit bars. No time stop because several eventual winners start slowly. Activation1R chosen before experiment; no threshold sweep.',
  scope:'All four windows development; fixed RR targets retained to isolate entry/exit. Not full AI/live replay. No promotion from this matrix alone. Structural-target and fresh forward validation required if promising.',promotionEligible:false};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const d of parent.datasets){
  if(sha(d.file)!==d.sha256)throw Error('dataset changed');const data=read(d.file);
  const file=join(prior,d.id+'-candidates.json');if(sha(file)!==parent.candidateHashes[d.id])throw Error('candidates changed');
  const core=read(file).candidates.current_core;
  const byTf=Object.fromEntries(Object.entries(data.byTf).filter(([tf])=>tf!=='1m').map(([tf,rows])=>[tf,(rows as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  const retests=confirmedCoreRetests(core,byTf);
  writeFileSync(join(out,d.id+'-retests.json'),JSON.stringify(retests,null,2));
  for(const slippage of [.001,.002]){
   let baseline:ReturnType<typeof replayCoreCandidates>|undefined;
   const cost=slippage===.001?'base':'stress';
   for(const variant of variants){
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,start:Date.parse(d.start),end:Date.parse(d.end),
      candidates:variant==='confirmed_retest'||variant==='retest_protection'?retests.accepted:core,
      wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,slippage,
      exitPolicy:variant==='cost_protection'||variant==='retest_protection'?'cost_protection_1r':undefined});
    if(variant==='baseline'){
      baseline=result;const original=read(join(prior,`${d.id}-current_core-${cost}.json`));
      if(JSON.stringify(result.summary)!==JSON.stringify(original.summary)||JSON.stringify(result.closes)!==JSON.stringify(original.closes)||JSON.stringify(result.events)!==JSON.stringify(original.events))throw Error('baseline parity failed');
    }
    const comparison=compareCoreCohorts(baseline!.closes,result.closes);
    const row={split:d.id,variant,cost,...result.summary,comparison};summaries.push(row);
    writeFileSync(join(out,`${d.id}-${variant}-${cost}.json`),JSON.stringify({...result,comparison},null,2));
    console.log(JSON.stringify(row));
   }
  }
 }
 for(const [p,h]of Object.entries(hashes))if(sha(p)!==h)throw Error('source changed');
 writeFileSync(join(out,'summary.json'),JSON.stringify({protocol,summaries,promotionEligible:false},null,2));
}
try{main();}catch(e){console.error(e);process.exitCode=1;}
