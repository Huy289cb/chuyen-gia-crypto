/** Compare the existing runtime2R protection rule with cash-aware BE, without tuning activation. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const parentDir=resolve('../docs/audits/2026-09-23-entry-exit/structural');
const out=resolve('../docs/audits/2026-09-23-entry-exit/cash-breakeven');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function main(){
 mkdirSync(out,{recursive:true});const parent=read(join(parentDir,'protocol.json'));
 const paths=[__filename,...['core-ablation-replay','core-entry-exit','core-ablation','opportunity-portfolio'].map(f=>resolve('src/backtest/'+f+'.ts')),
  ...['breakeven-sl','profit-protect-sl','ai-opportunity','execution-risk','ict-research'].map(f=>resolve('src/utils/'+f+'.ts'))];
 const sourceHashes=Object.fromEntries(paths.map(p=>[p,sha(p)]));
 const protocol={version:'cash-breakeven-v1',frozenAt:new Date().toISOString(),datasets:parent.datasets,sourceHashes,
  wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,variants:['fixed_buffer','cash_cost'],
  runtimeRules:{beAtR:2,trailActivatePct:2.5,trailDistancePct:.55,minSlMovePct:.05,minAgeMinutes:15,timeStopHours:0,fixedBufferPct:.08},
  hypothesis:'Fix0.08%buffer being less than transaction costs. Compare same2R activation, same trail and all owner limits; cash-cost BE includes accrued costs/funding and exit fees/slip, favorable0.1tick rounding. Evaluate amendments after each minute close, effective next minute. Original core3R synthetic targets retained; not full live AI or exchange replay.',
  scope:'All six windows already seen. Numerical accounting correction; does not prove positive strategy expectancy or guarantee fills at stop.',promotionEligible:false};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const d of parent.datasets){
  if(sha(d.file)!==d.sha256||sha(d.candidates)!==d.candidateHash)throw Error('input changed');
  const data=read(d.file),candidates=read(d.candidates).candidates.current_core;
  for(const slippage of [.001,.002]){
   let baseline:ReturnType<typeof replayCoreCandidates>|undefined;const cost=slippage===.001?'base':'stress';
   for(const variant of ['fixed_buffer','cash_cost'] as const){
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,start:Date.parse(d.start),end:Date.parse(d.end),
      candidates,wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,slippage,runtimeProfitProtect:variant});
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
