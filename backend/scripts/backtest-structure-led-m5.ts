/** Outcome-independent gate cohort replay; no network/DB/AI/order imports. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {selectStructureLedM5} from '../src/backtest/structure-led-m5';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const prior=resolve('../docs/audits/2026-09-21-core-ablation');
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'../docs/audits/2026-09-22-structure-led-m5');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function main(){
 const parent=read(join(prior,'summary.json')),p=parent.protocol;
 const candidates=Object.fromEntries(p.datasets.map((d:any)=>{
  const path=join(prior,d.id+'-candidates.json');if(sha(path)!==p.candidateHashes[d.id])throw Error('Candidate cache changed');
  const rows=read(path).candidates;return [d.id,selectStructureLedM5(rows.current_core,rows.without_5m_guard)];
 }));
 const paths=[__filename,resolve('src/backtest/structure-led-m5.ts'),resolve('src/backtest/core-ablation-replay.ts'),resolve('src/backtest/opportunity-portfolio.ts')];
 const hashes=Object.fromEntries(paths.map(path=>[path,sha(path)]));
 mkdirSync(out,{recursive:true});
 const protocol={version:'structure-led-m5-v1',frozenAt:new Date().toISOString(),parentProtocolSha256:sha(join(prior,'protocol.json')),
  sourceHashes:hashes,policy:p.policy,circuit:p.circuit,wallet:p.wallet,datasets:p.datasets,costs:p.costs,
  hypothesis:'Only M5 candidates blocked by core M5 guard, passing all remaining core gates. No selection by realized PnL, no RR/risk/SL change.',
  selectionDisclosure:'Chosen after inspecting positive added-trade cohorts in prior ablation; these four windows are development data, not fresh OOS.',
  prospectiveHoldout:'If development results justify further work, freeze this exact lane before collecting an untouched period. No automatic live promotion.',promotionEligible:false};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 writeFileSync(join(out,'candidates.json'),JSON.stringify(candidates));
 const summaries:any[]=[];
 for(const d of p.datasets){
  if(sha(d.file)!==d.sha256)throw Error('Dataset changed');const data=read(d.file);
  for(const slippage of [.001,.002]){
   const cost=slippage===.001?'base':'stress';
   const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates:candidates[d.id] as any,start:Date.parse(d.start),end:Date.parse(d.end),
    wallet:p.wallet,policy:p.policy,circuit:p.circuit,slippage});
   const baseline=read(join(prior,`${d.id}-current_core-${cost}.json`));
   const comparison=compareCoreCohorts(baseline.closes,result.closes);
   const row={split:d.id,cost,...result.summary,comparison};summaries.push(row);
   writeFileSync(join(out,`${d.id}-${cost}.json`),JSON.stringify({...result,comparison},null,2));
   console.log(JSON.stringify(row));
  }
 }
 for(const [path,hash] of Object.entries(hashes))if(sha(path)!==hash)throw Error('Source changed');
 writeFileSync(join(out,'summary.json'),JSON.stringify({protocol,summaries,promotionEligible:false},null,2));
}
try{main();}catch(e){console.error(e);process.exitCode=1;}
