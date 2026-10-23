/** Post-run integrity, cohort and prefix checks; never calls exchange or trading services. */
import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {collectCoreAblations,CORE_ABLATIONS} from '../src/backtest/core-ablation';
const root=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'../docs/audits/2026-09-21-core-ablation');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
async function main(){
 const summary=read(join(root,'summary.json')),protocol=summary.protocol;
 for(const [key,value] of Object.entries(protocol.environment))process.env[key]=String(value);
 const checks:any[]=[];
 if(summary.summaries.length!==protocol.datasets.length*CORE_ABLATIONS.length*2)throw Error('Incomplete matrix');
 for(const row of summary.summaries){
  const result=read(join(root,`${row.split}-${row.variant}-${row.cost}.json`));
  const sum=result.closes.reduce((s:number,c:any)=>s+c.netUsd,0);
  if(Math.abs(sum-row.netUsd)>1e-8)throw Error('Net mismatch');
  if(Math.abs(row.cohort.delta-(row.cohort.addedNet-row.cohort.removedNet+row.cohort.commonDelta))>1e-8)throw Error('Cohort mismatch');
  if(result.summary.fills!==result.closes.length)throw Error('Open trade lost');
  const fills=result.events.filter((e:any)=>e.type==='fill');
  for(const f of fills){const sub=result.events.find((e:any)=>e.type==='submit'&&e.plan.id===f.id);
   if(!sub||f.time<sub.time+60000)throw Error('Entry lookahead');}
 }
 checks.push({matrix:summary.summaries.length,cashAndCohorts:'pass',latency:'pass'});
 // Check actual detector output under truncated future data, not merely a helper fixture.
 const split=protocol.datasets[0],bytes=readFileSync(split.file);
 if(createHash('sha256').update(bytes).digest('hex')!==split.sha256)throw Error('Dataset mismatch');
 const raw=JSON.parse(bytes.toString()),start=Date.parse(split.start),cutoff=start+7*86400000;
 const durations:Record<string,number>={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
 const data=Object.fromEntries(Object.keys(durations).map(tf=>[tf,raw.byTf[tf].filter((b:number[])=>b[0]+durations[tf]<=cutoff)
  .map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))]));
 const prefix=await collectCoreAblations(data,start,cutoff);
 const full=read(join(root,split.id+'-candidates.json'));
 for(const v of CORE_ABLATIONS){
  const expected=full.candidates[v].filter((c:any)=>c.time<cutoff);
  if(JSON.stringify(prefix.candidates[v])!==JSON.stringify(expected))throw Error('Prefix changed: '+v);
 }
 checks.push({prefixDays:7,variants:CORE_ABLATIONS.length,result:'pass'});
 writeFileSync(join(root,process.argv.find(a=>a.startsWith('--verification-file='))?.slice(20)??'verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks},null,2));console.log(JSON.stringify(checks));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
