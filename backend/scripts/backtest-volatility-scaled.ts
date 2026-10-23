/** Frozen hypothesis: volatility-normalized regime; all risk/structure guards retained. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {collectCoreAblations} from '../src/backtest/core-ablation';
import {boundCoreCandidates} from '../src/backtest/structure-led-m5-bounded';
import {VOLATILITY_SCALED_RULES} from '../src/backtest/volatility-scaled-regime';
import {replayCoreCandidates,compareCoreCohorts} from '../src/backtest/core-ablation-replay';
const out=resolve('../docs/audits/2026-09-22-volatility-scaled'),prior=resolve('../docs/audits/2026-09-21-core-ablation');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function hashes(dir:string):Record<string,string>{const r:Record<string,string>={};for(const f of readdirSync(dir,{withFileTypes:true})){const p=join(dir,f.name);if(f.isDirectory())Object.assign(r,hashes(p));else if(/\.(ts|js)$/.test(p))r[p]=sha(p);}return r;}
async function main(){
 const parent=read(join(prior,'protocol.json'));
 for(const [k,v] of Object.entries(parent.environment))process.env[k]=String(v);
 const sourceHashes={...hashes(resolve('src')),[__filename]:sha(__filename)};
 mkdirSync(out,{recursive:true});
 const protocol={version:'volatility-scaled-core-v1',frozenAt:new Date().toISOString(),rules:VOLATILITY_SCALED_RULES,variants:['current_core','volatility_scaled','volatility_scaled_bounded'],
  policy:parent.policy,circuit:parent.circuit,wallet:parent.wallet,environment:parent.environment,datasets:parent.datasets,costs:parent.costs,sourceHashes,
  hypothesis:'Trend iff direction efficiency>=0.3 and net movement>=2 meanATR14 over existing50/72-bar window, otherwise range; consistent across setup and HTF evidence. Preserve structure/BOS/side-align/grade/pullback/M5/risk guards. Optional bounded arm uses actual6 source-TF candles and nearest unswept H1/H4 target.',
  limitations:'Development/revalidation only; these2023-2025 windows already inspected. No retrospective parameter retuning. Current baseline cached from prior trial, checked by default-path prefix regression.',promotionEligible:false};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const d of parent.datasets){
  if(sha(d.file)!==d.sha256)throw Error('Dataset changed');const data=read(d.file),start=Date.parse(d.start),end=Date.parse(d.end);
  const byTf=Object.fromEntries(Object.entries(data.byTf).filter(([tf])=>tf!=='1m').map(([tf,bars])=>[tf,(bars as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  const collected=await collectCoreAblations(byTf,start,end,['current_core'],'volatility_scaled');
  const all=collected.candidates.current_core,bounded=boundCoreCandidates(all,byTf,parent.policy.minSlFraction);
  const candidates={volatility_scaled:all,volatility_scaled_bounded:bounded.accepted};
  writeFileSync(join(out,d.id+'-candidates.json'),JSON.stringify({candidates,gateBlocks:collected.blocks,boundedRejections:bounded.rejected}));
  console.log(JSON.stringify({split:d.id,candidates:all.length,bounded:bounded.accepted.length}));
  for(const slip of [.001,.002]){
   const cost=slip===.001?'base':'stress',baseline=read(join(prior,`${d.id}-current_core-${cost}.json`));
   summaries.push({split:d.id,variant:'current_core',cost,...baseline.summary,comparison:compareCoreCohorts(baseline.closes,baseline.closes)});
   for(const variant of ['volatility_scaled','volatility_scaled_bounded'] as const){
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates:candidates[variant],start,end,wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,slippage:slip});
    const comparison=compareCoreCohorts(baseline.closes,result.closes),row={split:d.id,variant,cost,...result.summary,comparison};summaries.push(row);
    writeFileSync(join(out,`${d.id}-${variant}-${cost}.json`),JSON.stringify({...result,comparison},null,2));console.log(JSON.stringify(row));
   }
  }
 }
 if(JSON.stringify(sourceHashes)!==JSON.stringify({...hashes(resolve('src')),[__filename]:sha(__filename)}))throw Error('Sources changed during run');
 writeFileSync(join(out,'summary.json'),JSON.stringify({protocol,summaries,promotionEligible:false},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
