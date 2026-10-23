import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {advanceCausalInventory,emptyCausalInventory} from '../../src/services/causal-opportunity-inventory.service';
import type {H1Bar} from '../../src/utils/h1-causal-plan';

it('reproduces all frozen development setup resolutions across serialized restart and repeated tick',()=>{
 const root=resolve(process.cwd(),'..');
 const reg=JSON.parse(readFileSync(resolve(root,'docs/audits/2026-10-04-h1-feasibility/registration.json'),'utf8'));
 const data=JSON.parse(readFileSync(resolve(root,reg.dataset),'utf8'));
 const durations:Record<string,number>={'1h':3600000,'5m':300000,'15m':900000,'4h':14400000};
 const all:Record<string,H1Bar[]>={};const cursors:Record<string,number>={};
 for(const tf of Object.keys(durations)){
  all[tf]=data.byTf[tf].map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));cursors[tf]=0;
 }
 const expected=new Map<string,unknown>();
 for(const mechanism of ['h1','h2']){
  const inventory=JSON.parse(readFileSync(resolve(root,`docs/audits/2026-10-04-${mechanism}-feasibility/inventory.json`),'utf8'));
  for(const row of inventory)if(row.window)expected.set(row.candidate.id,{status:row.status,resolvedAt:row.resolvedAt,plan:row.plan});
 }
 const actual=new Map<string,unknown>();let state=emptyCausalInventory(),observed=0,resolved=0;
 for(const tick of all['5m']){
  const at=tick.timestamp+300000+5000;if(at<reg.warmup_start||at>reg.end)continue;
  const prefix:Record<string,H1Bar[]>={};
  for(const tf of Object.keys(durations)){
   while(cursors[tf]<all[tf].length&&all[tf][cursors[tf]].timestamp+durations[tf]+5000<=at)cursors[tf]++;
   prefix[tf]=all[tf].slice(0,cursors[tf]);
  }
  const bars={hour:prefix['1h'],five:prefix['5m'],fifteen:prefix['15m'],fourHour:prefix['4h']};
  const result=advanceCausalInventory({state,at,bars});
  // Simulates a serialized checkpoint reload on every tick, rather than in-memory-only dedup.
  state=JSON.parse(JSON.stringify(result.state));
  expect(advanceCausalInventory({state,at,bars}).events).toEqual([]);
  for(const event of result.events){
   if(event.row.candidate.knownAt<reg.start)continue;
   if(event.kind==='observed')observed++;
   else{resolved++;actual.set(event.row.candidate.id,{status:event.outcome!.status,resolvedAt:at,plan:event.outcome});}
  }
 }
 expect(observed).toBe(121);expect(resolved).toBe(121);expect(actual).toEqual(expected);
 expect([...actual.values()].filter((r:any)=>r.status==='plan')).toHaveLength(67);
 expect(()=>advanceCausalInventory({state,at:state.lastAt!-1,bars:{hour:[],five:[],fifteen:[],fourHour:[]}})).toThrow('clock');
},60000);
