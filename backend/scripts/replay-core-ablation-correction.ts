/** Mechanical execution correction. Preserve first trial; reuse byte-identical detector candidates. */
import 'dotenv/config';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {CORE_ABLATIONS} from '../src/backtest/core-ablation';
import {buildIctH1Structure} from '../src/utils/ict-research';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const out=resolve('../docs/audits/2026-09-21-core-ablation'),previous=join(out,'pre-gap-correction');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function main(){
 const original=read(join(out,'summary.json')),p=original.protocol;
 const hashes:Record<string,string>={};
 for(const [path,hash] of Object.entries(p.sourceHashes)){
  const actual=sha(readFileSync(path));
  if(!path.endsWith('/src/backtest/core-ablation-replay.ts')&&actual!==hash)throw Error('Detector or unrelated source changed: '+path);
  hashes[path]=actual;
 }
 hashes[__filename]=sha(readFileSync(__filename));
 const candidateHashes=Object.fromEntries(p.datasets.map((d:any)=>[d.id,sha(readFileSync(join(out,d.id+'-candidates.json')))]));
 mkdirSync(previous); // Fail closed on a second correction attempt.
 for(const row of original.summaries){const file=`${row.split}-${row.variant}-${row.cost}.json`;renameSync(join(out,file),join(previous,file));}
 for(const file of ['protocol.json','summary.json','run.log'])renameSync(join(out,file),join(previous,file));
 const protocol={...p,version:'core-ablation-v2-gap-corrected',frozenAt:new Date().toISOString(),sourceHashes:hashes,candidateHashes,
  correction:'Resting limit gap through stop now fills and stops at open; source detector/candidates/parameters unchanged. Initial outcomes retained in pre-gap-correction.',
  parentProtocolSha256:sha(readFileSync(join(previous,'protocol.json')))};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const d of p.datasets){
  const bytes=readFileSync(d.file);if(sha(bytes)!==d.sha256)throw Error('Dataset changed');const data=JSON.parse(bytes.toString());
  const collected=read(join(out,d.id+'-candidates.json'));
  const h1=buildIctH1Structure(data.byTf['1h'].map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]})));
  for(const slippage of [.001,.002]){
   let baseline:ReturnType<typeof replayCoreCandidates>|undefined;
   for(const variant of CORE_ABLATIONS){
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates:collected.candidates[variant],start:Date.parse(d.start),end:Date.parse(d.end),wallet:p.wallet,policy:p.policy,circuit:p.circuit,slippage,h1:variant==='protected_h1'?h1:undefined});
    if(variant==='current_core')baseline=result;
    const cost=slippage===.001?'base':'stress',cohort=compareCoreCohorts(baseline!.closes,result.closes);
    const row={split:d.id,variant,cost,...result.summary,cohort,gateBlocks:collected.blocks[variant]};summaries.push(row);
    writeFileSync(join(out,`${d.id}-${variant}-${cost}.json`),JSON.stringify({...result,comparison:cohort},null,2));
   }
  }
  console.log('Corrected replay complete: '+d.id);
 }
 for(const [path,hash] of Object.entries(hashes))if(sha(readFileSync(path))!==hash)throw Error('Source changed');
 for(const d of p.datasets)if(sha(readFileSync(join(out,d.id+'-candidates.json')))!==candidateHashes[d.id])throw Error('Candidates changed');
 writeFileSync(join(out,'summary.json'),JSON.stringify({...original,protocol,summaries},null,2));
 const changes=summaries.filter(row=>{const old=original.summaries.find((x:any)=>x.split===row.split&&x.variant===row.variant&&x.cost===row.cost);return Math.abs(old.netUsd-row.netUsd)>1e-10||old.trades!==row.trades;});
 writeFileSync(join(out,'gap-correction-verification.json'),JSON.stringify({unchangedCandidateHashes:candidateHashes,changedScenarios:changes.map(x=>({split:x.split,variant:x.variant,cost:x.cost,trades:x.trades,netUsd:x.netUsd})),allScenarios:summaries.length},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
