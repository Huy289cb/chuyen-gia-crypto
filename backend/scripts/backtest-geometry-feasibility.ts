/** Research-only 2x2 geometry/admission experiment; NEVER changes live .env/PM2/leverage. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {boundCoreCandidates} from '../src/backtest/structure-led-m5-bounded';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const root=resolve('../docs/audits/2026-09-22-geometry-feasibility'),prior=resolve('../docs/audits/2026-09-21-core-ablation');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const variants=[{id:'floor008_usd100',floor:.008,equityCap:null},{id:'floor004_usd100',floor:.004,equityCap:null},
 {id:'floor008_equity500',floor:.008,equityCap:500},{id:'floor004_equity500',floor:.004,equityCap:500}];
function main(){
 const parent=read(join(prior,'protocol.json'));
 const files=[__filename,resolve('src/backtest/structure-led-m5-bounded.ts'),resolve('src/backtest/core-ablation.ts'),resolve('src/backtest/core-ablation-replay.ts'),resolve('src/backtest/opportunity-portfolio.ts'),resolve('src/utils/ai-opportunity.ts'),resolve('src/utils/execution-risk.ts')];
 const hashes=Object.fromEntries(files.map(p=>[p,sha(p)]));
 mkdirSync(root,{recursive:true});
 const protocol={version:'structural-floor-exposure-v1',frozenAt:new Date().toISOString(),variants,sourceHashes:hashes,
  datasets:parent.datasets,wallet:parent.wallet,basePolicy:parent.policy,baseCircuit:parent.circuit,costs:parent.costs,
  hypothesis:'Current core detector unchanged. Structural stop beyond six closed source-TF candles plus tick, with floor0.8% or0.4%; target capped at nearest unswept H1/H4 barrier and original3R reference. Exposure either originalUSD100 or500% current wallet without fixedUSD cap. Owner max risk3%,day10%,cooldown60m,target0.5% unchanged.',
  financialScope:'Research only. Live SL floor/exposure remain unchanged. No leverage change; observed .env leverage20, proposed exposure ceiling5x wallet uses at most25% wallet as initial margin before exchange-specific maintenance/fees. Full margin/liquidation parity not claimed.',
  selection:'One frozen2x2 test; all windows already inspected. No OOS claim, no retuning within trial.',promotionEligible:false};
 writeFileSync(join(root,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const d of parent.datasets){
  if(sha(d.file)!==d.sha256)throw Error('Changed dataset');const data=read(d.file),start=Date.parse(d.start),end=Date.parse(d.end);
  const candidatePath=join(prior,d.id+'-candidates.json');if(sha(candidatePath)!==parent.candidateHashes[d.id])throw Error('Changed candidates');
  const core=read(candidatePath).candidates.current_core;
  const byTf=Object.fromEntries(Object.entries(data.byTf).filter(([tf])=>tf!=='1m').map(([tf,rows])=>[tf,(rows as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  for(const slip of [.001,.002]){
   let geometryBaseline:ReturnType<typeof replayCoreCandidates>|undefined;
   const cost=slip===.001?'base':'stress',coreReference=read(join(prior,`${d.id}-current_core-${cost}.json`));
   for(const variant of variants){
    const plans=boundCoreCandidates(core,byTf,variant.floor);
    // Infinity is an explicit no-fixed-cap sentinel, bounded by equity exposure in finance().
    const policy={...parent.policy,minSlFraction:variant.floor,maxExposure:variant.equityCap?Infinity:parent.policy.maxExposure};
    const circuit={...parent.circuit,maxExposurePercentOfEquity:variant.equityCap};
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates:plans.accepted,start,end,wallet:parent.wallet,policy,circuit,slippage:slip});
    if(!geometryBaseline)geometryBaseline=result;
    const comparison=compareCoreCohorts(geometryBaseline.closes,result.closes),versusCore=compareCoreCohorts(coreReference.closes,result.closes);
    const row={split:d.id,variant:variant.id,cost,...result.summary,comparison,versusCore,rejectedGeometry:plans.rejected.length};summaries.push(row);
    writeFileSync(join(root,`${d.id}-${variant.id}-${cost}.json`),JSON.stringify({...result,comparison,versusCore,rejectedGeometry:plans.rejected},null,2));
    console.log(JSON.stringify(row));
   }
  }
 }
 for(const [p,h] of Object.entries(hashes))if(sha(p)!==h)throw Error('Source changed');
 writeFileSync(join(root,'summary.json'),JSON.stringify({protocol,summaries,promotionEligible:false},null,2));
}
try{main();}catch(e){console.error(e);process.exitCode=1;}
