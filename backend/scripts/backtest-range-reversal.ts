import 'dotenv/config';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {runAdaptiveSetupReplay} from '../src/backtest/adaptive-setup-replay';
import {replayCoreCandidates} from '../src/backtest/core-ablation-replay';
import type {CoreCandidate} from '../src/backtest/core-ablation';
const root=resolve('../docs/audits/2026-09-24-range-implementation');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function main(){
 mkdirSync(root,{recursive:true});
 const parent=read(resolve('../docs/audits/2026-09-23-entry-exit/structural/protocol.json'));
 const protocol={version:'range-mirror-v1',frozenAt:new Date().toISOString(),datasets:parent.datasets,policy:parent.policy,circuit:parent.circuit,wallet:parent.wallet,
  variants:['long','mirror_short'],rr:1.5,sl:.008,entry:'Closed 5m confirmation; resting limit on subsequent minutes, adverse stop gaps and conservative ambiguous ordering. Inventory independent of positions.',
  scope:'Deterministic candidate screen, not full AI/live execution parity. Previously seen historical windows. Fixed exits; end liquidation. No promotion solely from one profitable period.',
  sourceHashes:Object.fromEntries(['src/backtest/adaptive-setup-replay.ts','src/backtest/core-ablation-replay.ts','scripts/backtest-range-reversal.ts'].map(p=>[p,sha(p)]))};
 writeFileSync(join(root,'backtest-protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const rows:any[]=[];
 for(const d of parent.datasets){
  if(sha(d.file)!==d.sha256)throw Error('Data changed');
  const data=read(d.file);const inventory:CoreCandidate[]=[];
  const byTf=Object.fromEntries(Object.entries(data.byTf).filter(([tf])=>tf!=='1m').map(([tf,bs])=>[tf,(bs as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
  await runAdaptiveSetupReplay({byTf,start:new Date(d.start),end:new Date(d.end),collectOnly:true,minSlPct:.008,rrByKind:{range_sweep_reclaim:1.5},rangeLong5mOnly:true,
   candidateFilter:c=>c.kind==='range_sweep_reclaim'&&c.side==='long'&&c.timeframe==='5m',
   onConfirmed:(c,time,entry)=>inventory.push({id:`range:${c.breakoutBarOpenMs}:${time}`,time,side:'long',timeframe:'5m',setup:'range_sweep_reclaim',entry,
     stopLoss:Math.floor(entry*.992*10)/10,takeProfit:Math.round(entry*1.012*10)/10,targetBound:Math.round(entry*1.012*10)/10} as CoreCandidate)});
  writeFileSync(join(root,d.id+'-inventory.json'),JSON.stringify(inventory));
  for(const side of ['long','mirror_short'])for(const slippage of [.001,.002]){
   const candidates=inventory.map(c=>side==='long'?c:{...c,side:'short' as const,stopLoss:2*c.entry-c.stopLoss,takeProfit:2*c.entry-c.takeProfit,targetBound:2*c.entry-c.takeProfit});
   const r=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates,start:Date.parse(d.start),end:Date.parse(d.end),wallet:parent.wallet,policy:parent.policy,circuit:parent.circuit,slippage});
   const row={split:d.id,side,cost:slippage===.001?'base':'stress',...r.summary}; rows.push(row);console.log(JSON.stringify(row));
   writeFileSync(join(root,`${d.id}-${side}-${row.cost}.json`),JSON.stringify(r));
  }
 }
 writeFileSync(join(root,'backtest-summary.json'),JSON.stringify(rows,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
