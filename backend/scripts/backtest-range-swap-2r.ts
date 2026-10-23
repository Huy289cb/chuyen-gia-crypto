/** Exactly swap the boundaries of a long2R: short stop at oldTP, short target at oldSL. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {replayCoreCandidates} from '../src/backtest/core-ablation-replay';
import type {CoreCandidate} from '../src/backtest/core-ablation';
const parentDir=resolve('../docs/audits/2026-09-24-range-rr'),out=resolve('../docs/audits/2026-09-24-swap-2r');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function main(){
 mkdirSync(out,{recursive:true});const parent=read(join(parentDir,'protocol.json'));
 const protocol={version:'swap-long2R-v1',frozenAt:new Date().toISOString(),datasets:parent.datasets,wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,
  variants:['long_2R','short_swapped_0.5R'],geometry:'Long: E, SL=L, TP=roundTick(E+2*(E-L)); short: same E, SL=longTP, TP=L. NOT same-stop mirror.',
  sourceHashes:Object.fromEntries(['scripts/backtest-range-swap-2r.ts','src/backtest/core-ablation-replay.ts','src/backtest/opportunity-portfolio.ts','src/utils/execution-risk.ts'].map(p=>[p,sha(p)])),
  scope:'Same134 range-long signals. Independent chronological portfolio with unchanged3% risk/day10/cooldown/minlot and costs. Old history, not OOS. Baseline exact parity with prior long2R. No AI/infrastructure costs; no automatic policy loosening.'};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});const rows:any[]=[];
 for(const d of protocol.datasets){
  if(sha(d.file)!==d.sha256||sha(d.inventory)!==d.inventoryHash)throw Error('input changed');const data=read(d.file),inventory:CoreCandidate[]=read(d.inventory);
  for(const variant of protocol.variants)for(const slippage of [.001,.002]){
   const candidates=inventory.map(c=>{const longTarget=Math.round((c.entry+2*Math.abs(c.entry-c.stopLoss))*10)/10;
    return variant==='long_2R'?{...c,takeProfit:longTarget,targetBound:longTarget}:{...c,side:'short' as const,stopLoss:longTarget,takeProfit:c.stopLoss,targetBound:c.stopLoss};});
   const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates,start:Date.parse(d.start),end:Date.parse(d.end),wallet:protocol.wallet,policy:protocol.policy,circuit:protocol.circuit,slippage});
   const cost=slippage===.001?'base':'stress';if(variant==='long_2R'&&JSON.stringify(result)!==JSON.stringify(read(join(parentDir,`${d.id}-long-2-${cost}.json`))))throw Error('baseline parity failed');
   const row={split:d.id,variant,cost,...result.summary};rows.push(row);writeFileSync(join(out,`${d.id}-${variant}-${cost}.json`),JSON.stringify(result));console.log(JSON.stringify(row));
  }
 }
 for(const [file,h]of Object.entries(protocol.sourceHashes))if(sha(file)!==h)throw Error('source changed');writeFileSync(join(out,'summary.json'),JSON.stringify(rows,null,2));
}
try{main();}catch(e){console.error(e);process.exitCode=1;}
