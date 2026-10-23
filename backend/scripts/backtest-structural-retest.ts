/** Follow-up: same retest rule with structural SL/TP on six already inspected windows. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {confirmedCoreRetests} from '../src/backtest/core-entry-exit';
import {boundCoreCandidates} from '../src/backtest/structure-led-m5-bounded';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const base=resolve('../docs/audits/2026-09-21-core-ablation');
const old=resolve('../docs/audits/2026-09-22-structure-led-m5/holdout-2022');
const out=resolve('../docs/audits/2026-09-23-entry-exit/structural');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function main(){
 mkdirSync(out,{recursive:true});const parent=read(join(base,'protocol.json')),older=read(join(old,'protocol.json'));
 const datasets=[...parent.datasets.map((d:any)=>({...d,candidates:join(base,d.id+'-candidates.json')})),
  ...older.datasets.map((d:any)=>({...d,start:d.scored[0],end:d.scored[1],candidates:join(old,d.id+'-candidates.json')}))]
  .map(d=>({...d,candidateHash:sha(d.candidates)}));
 const files=[__filename,...['core-entry-exit','core-ablation','core-ablation-replay','structure-led-m5-bounded','opportunity-portfolio'].map(f=>resolve('src/backtest/'+f+'.ts')),
  ...['ai-opportunity','execution-risk','ict-research'].map(f=>resolve('src/utils/'+f+'.ts'))];
 const sourceHashes=Object.fromEntries(files.map(p=>[p,sha(p)]));
 const protocol={version:'structural-retest-v1',frozenAt:new Date().toISOString(),datasets,sourceHashes,policy:parent.policy,circuit:parent.circuit,wallet:parent.wallet,
  variants:['bounded','bounded_retest'],hypothesis:'Same frozen retest rule, now using source-TF6bar stop and nearest unconsumed H1/H4 target capped at original3R before retest confirmation. No protective stop. Owner limits unchanged.',
  scope:'Six already inspected windows;2022 is no longer fresh holdout for this follow-up. No live promotion from development alone.',promotionEligible:false};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const d of datasets){
  if(sha(d.file)!==d.sha256||sha(d.candidates)!==d.candidateHash)throw Error('input changed');
  const data=read(d.file),core=read(d.candidates).candidates.current_core;
  const byTf=Object.fromEntries(Object.entries(data.byTf).filter(([tf])=>tf!=='1m').map(([tf,rows])=>[tf,(rows as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  const bounded=boundCoreCandidates(core,byTf,.008),retest=confirmedCoreRetests(bounded.accepted,byTf);
  writeFileSync(join(out,d.id+'-candidates.json'),JSON.stringify({bounded,retest},null,2));
  for(const slippage of [.001,.002]){
   let baseline:ReturnType<typeof replayCoreCandidates>|undefined;const cost=slippage===.001?'base':'stress';
   for(const variant of ['bounded','bounded_retest']){
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,start:Date.parse(d.start),end:Date.parse(d.end),
      candidates:variant==='bounded'?bounded.accepted:retest.accepted,wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,slippage});
    if(!baseline)baseline=result;
    const comparison=compareCoreCohorts(baseline.closes,result.closes);const row={split:d.id,variant,cost,...result.summary,comparison};summaries.push(row);
    writeFileSync(join(out,`${d.id}-${variant}-${cost}.json`),JSON.stringify({...result,comparison},null,2));console.log(JSON.stringify(row));
   }
  }
 }
 for(const [p,h]of Object.entries(sourceHashes))if(sha(p)!==h)throw Error('source changed');
 writeFileSync(join(out,'summary.json'),JSON.stringify({protocol,summaries,promotionEligible:false},null,2));
}
try{main();}catch(e){console.error(e);process.exitCode=1;}
