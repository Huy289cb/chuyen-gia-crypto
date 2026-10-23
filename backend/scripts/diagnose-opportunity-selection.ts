import {readFileSync,writeFileSync} from 'node:fs';
import {classifyStructureBias} from '../src/utils/structure-bias';
const root='../docs/audits/2026-09-11-opportunity-testbed/';
const data=JSON.parse(readFileSync(root+'train-data.json','utf8'));
const run=JSON.parse(readFileSync(root+'prospective-union-portfolio-deterministic_lowest_risk-base.json','utf8'));
const reservations=new Map<string,any>(run.events.filter((e:any)=>e.type==='reserve').map((e:any)=>[e.plan.id,e]));
const groups:Record<string,{trades:number;wins:number;netUsd:number}>={};
const rows=run.closes.map((c:any)=>{
 const e=reservations.get(c.planId),p=e.plan;
 const candles=data.byTf['4h'].filter((b:number[])=>b[0]+14400000<=e.time).slice(-120).map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));
 const bias=classifyStructureBias(candles,{strength:2}).bias;
 const aligned=(p.side==='long'&&bias==='bull')||(p.side==='short'&&bias==='bear');
 const opposite=(p.side==='long'&&bias==='bear')||(p.side==='short'&&bias==='bull');
 const relation=aligned?'aligned':opposite?'opposite':'transition';
 for(const key of [p.setup,'structure:'+relation]){const g=groups[key]??={trades:0,wins:0,netUsd:0};g.trades++;g.wins+=Number(c.netUsd>0);g.netUsd+=c.netUsd;}
 return {reservedAt:e.time,planId:p.id,setup:p.setup,side:p.side,bias,relation,netUsd:c.netUsd};
});
const result={scope:'Post-hoc TRAIN attribution, not causal ablation or independent validation. Filtering changes later wallet and opportunities.',groups,rows};
writeFileSync(root+'trial-007-selection-diagnostics.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(groups,null,2));
