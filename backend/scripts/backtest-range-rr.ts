/** Frozen TP-only matrix; inventories and execution engine reused without entry/SL tuning. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {replayCoreCandidates} from '../src/backtest/core-ablation-replay';
import type {CoreCandidate} from '../src/backtest/core-ablation';
const parentDir=resolve('../docs/audits/2026-09-24-range-implementation'),out=resolve('../docs/audits/2026-09-24-range-rr');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function main(){
 mkdirSync(out,{recursive:true});const parent=read(join(parentDir,'backtest-protocol.json'));
 const rrs=[.5,1,1.5,2];
 const protocol={version:'range-rr-v1',frozenAt:new Date().toISOString(),rrConvention:'reward / price risk; 0.5R also screens the alternative interpretation risk:reward2:1',rrs,
  datasets:parent.datasets.map((d:any)=>({...d,inventory:join(parentDir,d.id+'-inventory.json'),inventoryHash:sha(join(parentDir,d.id+'-inventory.json'))})),wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,
  sourceHashes:Object.fromEntries(['scripts/backtest-range-rr.ts','src/backtest/core-ablation-replay.ts','src/backtest/opportunity-portfolio.ts','src/utils/ai-opportunity.ts'].map(p=>[p,sha(p)])),
  scope:'TP-only screen on existing 134 range-long confirmations, long and mirror-short. No fresh OOS, no full AI parity. Each variant gets its own chronological portfolio and admission. 1.5R uses exact previous levels for baseline parity. No overhead cost included; failing before overhead cannot pass after it.'};
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const rows:any[]=[];
 for(const d of protocol.datasets){
  if(sha(d.file)!==d.sha256||sha(d.inventory)!==d.inventoryHash)throw Error('input changed');const data=read(d.file),inventory:CoreCandidate[]=read(d.inventory);
  for(const rr of rrs)for(const side of ['long','mirror_short'])for(const slippage of [.001,.002]){
   const candidates=inventory.map(c=>{const direction=side==='long'?1:-1;const stopLoss=direction===1?c.stopLoss:2*c.entry-c.stopLoss;
    const baselineTarget=direction===1?c.takeProfit:2*c.entry-c.takeProfit;
    const target=rr===1.5?baselineTarget:Math.round((c.entry+direction*Math.abs(c.entry-c.stopLoss)*rr)*10)/10;
    return {...c,side:direction===1?'long' as const:'short' as const,stopLoss,takeProfit:target,targetBound:target};});
   const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates,start:Date.parse(d.start),end:Date.parse(d.end),wallet:protocol.wallet,policy:protocol.policy,circuit:protocol.circuit,slippage});
   const cost=slippage===.001?'base':'stress';
   if(rr===1.5&&JSON.stringify(result)!==JSON.stringify(read(join(parentDir,`${d.id}-${side}-${cost}.json`))))throw Error('baseline parity failed');
   const row={split:d.id,rr,side,cost,...result.summary};rows.push(row);writeFileSync(join(out,`${d.id}-${side}-${rr}-${cost}.json`),JSON.stringify(result));console.log(JSON.stringify(row));
  }
 }
 for(const [file,h]of Object.entries(protocol.sourceHashes))if(sha(file)!==h)throw Error('source changed');
 writeFileSync(join(out,'summary.json'),JSON.stringify(rows,null,2));
}
try{main();}catch(e){console.error(e);process.exitCode=1;}
