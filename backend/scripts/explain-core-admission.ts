/** Read-only admission diagnosis at a fixed empty-account balance, NOT a portfolio replay. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {computeExecutionRisk} from '../src/utils/execution-risk';
import type {CoreCandidate} from '../src/backtest/core-ablation';

const prior=resolve('../docs/audits/2026-09-21-core-ablation');
const out=resolve('../docs/audits/2026-09-22-geometry-feasibility/admission-diagnosis.json');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const protocol=read(join(prior,'protocol.json'));
const {wallet,policy}=protocol;
const datasets=protocol.datasets.map((d:{id:string})=>{
  const file=join(prior,d.id+'-candidates.json');
  if(sha(file)!==protocol.candidateHashes[d.id])throw Error('Changed candidate stream');
  const rows=(read(file).candidates.current_core as CoreCandidate[]).map(c=>{
    const quantity=Math.max(.001,Math.ceil(50/c.entry/.001-1e-9)*.001);
    const notional=quantity*c.entry;
    const risk=computeExecutionRisk({entry:c.entry,stopLoss:c.stopLoss,quantity,balance:wallet,
      roundTripFeePercent:policy.feePercent,slippagePercent:policy.slippagePercent});
    const reasons:string[]=[];
    if(risk.totalRiskUsd>wallet*policy.maxRiskPercent/100+1e-9)reasons.push('per_trade_risk');
    if(risk.totalRiskUsd>wallet*policy.dailyPercent/100+1e-9)reasons.push('daily_risk');
    if(notional>policy.maxExposure+1e-9)reasons.push('exposure');
    return {id:c.id,time:c.time,entry:c.entry,quantity,notional,...risk,reasons,
      minimumBalanceForRisk: risk.totalRiskUsd/(policy.maxRiskPercent/100)};
  });
  return {split:d.id,candidates:rows.length,anyFinancialBlock:rows.filter(r=>r.reasons.length).length,
    perTradeRisk:rows.filter(r=>r.reasons.includes('per_trade_risk')).length,
    exposure:rows.filter(r=>r.reasons.includes('exposure')).length,
    bothRiskAndExposure:rows.filter(r=>r.reasons.includes('per_trade_risk')&&r.reasons.includes('exposure')).length,
    rows};
});
const result={createdAt:new Date().toISOString(),wallet,policy,
  scope:'Core minimum exchange quantity at fixed initial wallet with an empty account and full daily budget. Reasons overlap. No target-cost, funding, circuit, fill or PnL assessment. Not live observations or a recommendation to add capital.',
  sourceHashes:Object.fromEntries([__filename,resolve('src/utils/execution-risk.ts')].map(p=>[p,sha(p)])),datasets};
writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify(datasets.map(({rows,...summary})=>summary),null,2));
