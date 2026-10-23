/** Frozen offline experiment: no orders, LLM, DB or exchange requests. */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { getRiskPolicy } from '../src/config/risk-policy';
import { getAiOpportunityPolicy } from '../src/config/ai-opportunity-policy';
import { collectCoreAblations, CORE_ABLATIONS } from '../src/backtest/core-ablation';
import { replayCoreCandidates, compareCoreCohorts } from '../src/backtest/core-ablation-replay';
import type { BacktestCandle } from '../src/backtest/types';
import type { PortfolioCircuit } from '../src/backtest/opportunity-portfolio';
const out=resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6)??'../docs/audits/2026-09-21-core-ablation');
const parent=resolve('../docs/audits/2026-09-11-opportunity-testbed');
const splits=[
 {id:'history_2023',file:join(parent,'independent-2023/independent-2023-data.json'),start:'2023-01-01',end:'2023-07-01'},
 {id:'history_2024',file:join(parent,'supplemental-2024/supplemental-2024-data.json'),start:'2024-07-01',end:'2025-01-01'},
 {id:'train',file:join(parent,'train-data.json'),start:'2025-02-01',end:'2025-07-01'},
 {id:'validation',file:join(parent,'validation/validation-data.json'),start:'2025-07-01',end:'2025-10-01'},
];
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
function sourceHashes(dir:string):Record<string,string>{
 const r:Record<string,string>={};for(const item of readdirSync(dir,{withFileTypes:true})){
  const p=join(dir,item.name);if(item.isDirectory())Object.assign(r,sourceHashes(p));else if(/\.(ts|js)$/.test(p))r[p]=sha(readFileSync(p));
 }return r;
}
async function main(){
 mkdirSync(out,{recursive:true});
 const risk=getRiskPolicy(),base=getAiOpportunityPolicy();
 if(!base.pinned||base.targetPercent!==.5)throw Error('Owner policy must be BTC / 3% / day10 / cooldown1h / target0.5');
 const environment=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(V3_|MIN_SIGNAL_|MIN_SL_|MIN_RR_|RISK_PER_TRADE|MAX_EFFECTIVE_RISK|MAX_TOTAL_EXPOSURE|MAX_EXPOSURE_PERCENT|DAILY_LOSS|POST_CLOSE_|POST_LOSS_|PENDING_ORDER_REENTRY_|CONSECUTIVE_LOSS|LOSS_COOLDOWN|CIRCUIT_)/.test(k)&&!/KEY|SECRET|TOKEN|PASSWORD|URL/.test(k)));
 for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
 process.env.BINANCE_ENABLED='false';
 const circuit:PortfolioCircuit={maxDrawdownPercent:risk.maxDrawdownPercent,drawdownEnabled:risk.circuitDrawdownEnabled,
  expectancyEnabled:risk.circuitExpectancyKillEnabled,expectancyWindow:risk.circuitExpectancyWindow,expectancyMinSumR:risk.circuitExpectancyMinSumR,
  maxExposurePercentOfEquity:risk.maxExposurePercentOfEquity};
 const policy={...base,minRr:0,ttlMs:3600000,slippagePercent:Math.max(base.slippagePercent,.2)};
 const sources={...sourceHashes(resolve('src')), [__filename]:sha(readFileSync(__filename))};
 const datasets=splits.map(s=>({...s,sha256:sha(readFileSync(s.file))}));
 const protocol={version:'core-ablation-v1',frozenAt:new Date().toISOString(),wallet:32.2009046,variants:CORE_ABLATIONS,datasets,environment,
  risk,policy,circuit,sourceHashes:sources,costs:{feePerSide:.0005,roundTripSlippage:[.001,.002],ai:0,aiReason:'No AI calls; deterministic research only'},
  execution:'1m strict limit penetration 0.1 USD; 1m latency; TTL60m; stop-first ambiguity; all close/cancel cooldown60m; liquidation with costs at end',
  hypothesis:'Single component ablations of current deterministic core; RR/structure/exit variants; July proxy disables structure, side-align and pullback with RR2, not archived AI replay',
  selection:'All variants declared before outcomes, every result retained; all datasets previously inspected, none is fresh OOS',
  promotionEligible:false};
 // Each invocation is immutable. A rerun uses a separate directory argument in a copied protocol, never silently overwrites results.
 writeFileSync(join(out,'protocol.json'),JSON.stringify(protocol,null,2),{flag:'wx'});
 const summaries:any[]=[];
 for(const split of datasets){
  const bytes=readFileSync(split.file);if(sha(bytes)!==split.sha256)throw Error('Dataset changed');
  const data=JSON.parse(bytes.toString()),start=Date.parse(split.start),end=Date.parse(split.end);
  const byTf=Object.fromEntries(Object.entries(data.byTf).filter(([tf])=>tf!=='1m').map(([tf,rows])=>[tf,(rows as number[][]).map(b=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))])) as Record<string,BacktestCandle[]>;
  const collected=await collectCoreAblations(byTf,start,end);
  writeFileSync(join(out,split.id+'-candidates.json'),JSON.stringify({steps:collected.steps,blocks:collected.blocks,candidates:collected.candidates}));
  console.log(JSON.stringify({split:split.id,candidates:Object.fromEntries(CORE_ABLATIONS.map(v=>[v,collected.candidates[v].length]))}));
  for(const slippage of [.001,.002]){
   let baseline:ReturnType<typeof replayCoreCandidates>|undefined;
   for(const variant of CORE_ABLATIONS){
    const result=replayCoreCandidates({bars:data.byTf['1m'],funding:data.funding,candidates:collected.candidates[variant],start,end,
      wallet:protocol.wallet,policy,circuit,slippage,h1:variant==='protected_h1'?collected.h1:undefined});
    if(variant==='current_core')baseline=result;
    const cost=slippage===.001?'base':'stress',cohort=compareCoreCohorts(baseline!.closes,result.closes);
    const row={split:split.id,variant,cost,...result.summary,cohort,gateBlocks:collected.blocks[variant]};summaries.push(row);
    writeFileSync(join(out,`${split.id}-${variant}-${cost}.json`),JSON.stringify({...result,comparison:cohort},null,2));
    console.log(JSON.stringify({split:split.id,variant,cost,trades:row.trades,net:row.netUsd,roi:row.roiPercent,delta:cohort.delta}));
   }
  }
 }
 if(JSON.stringify(sources)!==JSON.stringify({...sourceHashes(resolve('src')),[__filename]:sha(readFileSync(__filename))}))throw Error('Source changed during experiment');
 writeFileSync(join(out,'summary.json'),JSON.stringify({protocol,summaries,promotionEligible:false,limitations:[
  'Current deterministic core only, not complete live range/retest/AI strategy. July rule proxy is not the exact deployment; historical env and AI decisions are unrecoverable here.',
  'Fixed RR exits intentionally synthetic in all variants except structural_exit. They diagnose gate selection and cannot justify live TP beyond structural barriers.',
  'Single component removals are diagnostics, not proposals to bypass safety. All owner financial constraints remain pinned.',
  'Source-timeframe metadata adapted to generic portfolio 15m scope; fixed current minlot/notional, no historical exchange filter verification.',
  'Unknown queue/partial fills, conservative intraminute ordering, closed-bar mark approximation. Full live admission parity is not claimed.',
  'Target economics excludes future funding forecasts; historical funding is charged. Zero AI is justified only for deterministic research.',
  'Different cost paths can alter subsequent wallet admissions. Cohort delta includes displaced trades and common-trade sizing/exit effects.',
  'All four windows previously inspected. No statistical promotion or fresh OOS claim; MAE/MFE are full-bar upper bounds.'
 ]},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
