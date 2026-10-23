/** Offline research: no exchange, DB, scheduler, provider or execution imports. */
import 'dotenv/config';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getAiOpportunityPolicy} from '../src/config/ai-opportunity-policy';
import {getRiskPolicy} from '../src/config/risk-policy';
import {OpportunityPortfolio} from '../src/backtest/opportunity-portfolio';
import {opportunityPlanBlock,type OpportunityPlan} from '../src/utils/ai-opportunity';
import {buildIctContinuationCandidates,buildIctH1Structure,evaluateIctTargetEconomics,ictStructurePermits,
  ictResearchGates,selectIctResearchCandidates,ICT_RESEARCH_VARIANTS,type IctBar} from '../src/utils/ict-research';
import {buildDailyLiquidityCandidates,DAILY_VARIANTS,type DailyVariant} from '../src/utils/ict-daily-liquidity-research';
const out='../docs/audits/2026-09-20-ict-daily-liquidity/';
const protocol=JSON.parse(readFileSync(out+'protocol.json','utf8'));
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';
const sourceFiles=[__filename,'src/utils/ict-daily-liquidity-research.ts','src/utils/ict-research.ts','src/backtest/opportunity-portfolio.ts','src/utils/ai-opportunity.ts','src/config/risk-policy.ts','src/config/ai-opportunity-policy.ts'];
const hashes=()=>Object.fromEntries(sourceFiles.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const initialHashes=hashes();const risk=getRiskPolicy(),basePolicy=getAiOpportunityPolicy();
if(!basePolicy.pinned||basePolicy.targetPercent!==.5)throw Error('Owner policy mismatch');
if(JSON.stringify(protocol.variants)!==JSON.stringify(['continuation_cost_h1',...DAILY_VARIANTS]))throw Error('Trial variants changed');
const circuit={maxDrawdownPercent:risk.maxDrawdownPercent,drawdownEnabled:risk.circuitDrawdownEnabled,
 expectancyEnabled:risk.circuitExpectancyKillEnabled,expectancyWindow:risk.circuitExpectancyWindow,
 expectancyMinSumR:risk.circuitExpectancyMinSumR,maxExposurePercentOfEquity:risk.maxExposurePercentOfEquity};
const parent=JSON.parse(readFileSync('../docs/audits/2026-09-20-ict-extended/summary.json','utf8'));
if(JSON.stringify(basePolicy)!==JSON.stringify(parent.admissionPolicy)||JSON.stringify(circuit)!==JSON.stringify(parent.circuit))throw Error('Frozen risk/circuit changed');
const costBlock=(p:OpportunityPlan):string|null=>{
 const e=evaluateIctTargetEconomics({side:p.side,entry:p.entry,target:p.takeProfit,quantity:p.quantity,
  feePerSide:.0005,slippageFraction:.002,fundingReserveUsd:0,aiCostUsd:0});
 return e.allowed?null:e.reason;
};
const summaries:any[]=[];
for(const split of Object.keys(protocol.splits)){
 const candidateFile=JSON.parse(readFileSync(protocol.candidateSources[split],'utf8'));
 const raw=readFileSync(candidateFile.dataset);if(createHash('sha256').update(raw).digest('hex')!==candidateFile.datasetSha256)throw Error('Dataset hash changed');
 const data=JSON.parse(raw.toString());const bars:number[][]=data.byTf['1m'];
 for(let i=0;i<bars.length;i++)if((i&&bars[i][0]-bars[i-1][0]!==60000)||!(bars[i][3]<=Math.min(bars[i][1],bars[i][4])&&Math.max(bars[i][1],bars[i][4])<=bars[i][2]))throw Error('Invalid minute history');
 const [start,end]=protocol.splits[split].map((s:string)=>Date.parse(s));
 const context={} as Record<'15m'|'1h'|'4h',IctBar[]>;
 for(const tf of ['15m','1h','4h'] as const)context[tf]=data.byTf[tf].map((b:number[])=>({timestamp:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));
 const h1=buildIctH1Structure(context['1h']),continuation=buildIctContinuationCandidates(context);
 const daily=Object.fromEntries(DAILY_VARIANTS.map(v=>[v,buildDailyLiquidityCandidates(context,v)]));
 for(const n of [1500,5000,context['15m'].length-500]){
  const cutoff=context['15m'][n-1].timestamp+900000;
  const prefix={'15m':context['15m'].slice(0,n),'1h':context['1h'].filter(b=>b.timestamp+3600000<=cutoff),'4h':context['4h'].filter(b=>b.timestamp+14400000<=cutoff)};
  for(const v of DAILY_VARIANTS)if(JSON.stringify(buildDailyLiquidityCandidates(prefix,v))!==JSON.stringify(daily[v].filter(c=>c.confirmedAt<cutoff)))throw Error(v+' prefix invariant failed');
  if(JSON.stringify(buildIctContinuationCandidates(prefix))!==JSON.stringify(continuation.filter(c=>c.confirmedAt<cutoff)))throw Error('Continuation prefix invariant failed');
  if(JSON.stringify(buildIctH1Structure(prefix['1h']))!==JSON.stringify(h1.filter(p=>p.knownAt<cutoff)))throw Error('H1 prefix invariant failed');
 }
 writeFileSync(out+split+'-candidates.json',JSON.stringify({dataset:candidateFile.dataset,datasetSha256:candidateFile.datasetSha256,
  daily,continuation,h1,prefixChecks:18},null,2));
 console.log(JSON.stringify({split,sweepCandidates:candidateFile.edge.length,continuationCandidates:continuation.length,prefixChecks:18}));
 for(const variant of protocol.variants)for(const slip of protocol.roundTripSlippage){
  // Same conservative admission reserve for both cost paths; stress must fit the 3% cap.
  const policy={...basePolicy,minRr:variant==='midpoint_rr3'?3:0,ttlMs:3600000,slippagePercent:Math.max(basePolicy.slippagePercent,.2)};
  const ledger=new OpportunityPortfolio(protocol.wallet,policy,circuit,.0005,slip);
  const gates={cost:true,h1:variant==='continuation_cost_h1'};
  const candidates=(variant==='continuation_cost_h1'?continuation:daily[variant as DailyVariant]).filter(c=>c.confirmedAt+1>=start&&c.confirmedAt+1<end);
  const byTime=new Map<number,any[]>();for(const c of candidates){const t=c.confirmedAt+1;byTime.set(t,[...(byTime.get(t)??[]),c]);}
  let fundingIndex=0,latestRate=NaN,submittedAt=0,ambiguous=0,expires=0,fills=0;
  const blocks:Record<string,number>={},events:any[]=[],equity:any[]=[];const count=(s:string)=>blocks[s]=(blocks[s]??0)+1;
  const settle=(time:number,mark:number)=>{
   while(fundingIndex<data.funding.length&&data.funding[fundingIndex].time<=time){
    const f=data.funding[fundingIndex++];latestRate=f.rate;
    if(f.time>=start){ledger.advance(f.time,mark);ledger.fund(f.rate,f.markPrice);}
   }
  };
  for(const b of bars){
   const [t,open,high,low,close]=b,finish=t+60000;
   if(t<start){while(fundingIndex<data.funding.length&&data.funding[fundingIndex].time<t+60000)latestRate=data.funding[fundingIndex++].rate;continue;}
   if(t>=end)break;
   settle(t,open);ledger.advance(t,open);
   if(ledger.pending&&t>=ledger.pending.expiresAt){ledger.cancel();expires++;events.push({time:t,type:'expired'});}
   let intrabarEntry=false;
   if(ledger.pending&&t>=submittedAt+60000){
    const p=ledger.pending,d=p.side==='long'?1:-1;
    if(gates.h1&&!ictStructurePermits(h1,p.side,submittedAt-1,t-1)){ledger.cancel();count('h1_invalidated_pending');}
    else if(d*(open-p.stopLoss)<=0){ledger.cancel();count('invalidated_before_fill');}
    else if(d*(open-p.takeProfit)>=0){ledger.cancel();count('target_consumed_before_fill');}
    else if(d===1?low<=p.entry-.1:high>=p.entry+.1){
     // Recheck budgets at fill without the reservation's occupied flag.
     const finance={...ledger.finance(latestRate),allowed:true};
     const blocked=(gates.h1&&!ictStructurePermits(h1,p.side,submittedAt-1,t-1)?'h1_structure':null) ?? (gates.cost?costBlock(p):null) ?? opportunityPlanBlock(p,finance,policy,t);
     if(blocked){ledger.cancel();count('fill_'+blocked);}
     else{intrabarEntry=d*(open-p.entry)>0;ledger.fill();fills++;events.push({time:t,type:'fill',id:p.id,entry:p.entry,quantity:p.quantity,rr:p.rr});}
    }else if(d===1?high>=p.takeProfit:low<=p.takeProfit){ledger.cancel();count('target_consumed_before_fill');}
   }
   let exit:null|{time:number;price:number;reason:string}=null;
   if(ledger.holding){
    const h=ledger.holding,p=h.plan,d=p.side==='long'?1:-1;
    const stop=d===1?low<=p.stopLoss:high>=p.stopLoss,target=d===1?high>=p.takeProfit:low<=p.takeProfit;
    if(d*(open-p.stopLoss)<=0)exit={time:t,price:open,reason:'gap_stop'};
    else if(!intrabarEntry&&d*(open-p.takeProfit)>=0)exit={time:t,price:p.takeProfit,reason:'gap_target'};
    else if(stop){if(target||intrabarEntry)ambiguous++;exit={time:finish,price:p.stopLoss,reason:target||intrabarEntry?'ambiguous_stop_first':'stop'};}
    else if(target&&!intrabarEntry)exit={time:finish,price:p.takeProfit,reason:'target'};
    else if(finish-h.entryTime>=48*3600000)exit={time:finish,price:close,reason:'time_exit'};
    else if(target&&intrabarEntry)ambiguous++;
   }
   if(exit){settle(exit.time,exit.price);ledger.advance(exit.time,exit.price);events.push({...ledger.close(exit.price),type:'close',reason:exit.reason});}
   settle(finish,close);ledger.advance(finish,close);
   if(finish%3600000===0)equity.push({time:finish,equity:ledger.equity,wallet:ledger.wallet});
   for(const c of byTime.get(finish)??[]){
    if(!c.target||Math.abs(c.target.price-c.entry)<=.1){count('missing_or_tick_target');continue;}
    if(gates.h1&&!ictStructurePermits(h1,c.side,c.confirmedAt,c.confirmedAt)){count('h1_structure');continue;}
    const occupied=ledger.block();if(occupied){count(occupied);continue;}
    const distance=Math.abs(c.entry-c.stopLoss),finance=ledger.finance(latestRate);
    const notional=Math.min(finance.remainingExposureUsd,finance.balance*policy.targetPercent/100/(distance/c.entry));
    const quantity=Math.max(.001,Math.ceil(50/c.entry/.001-1e-9)*.001,Math.floor(notional/c.entry/.001+1e-9)*.001);
    const p:OpportunityPlan={id:c.id,setup:c.setup??'ict_sweep_mss_fvg',side:c.side,symbol:'BTC',timeframe:'15m',entry:c.entry,stopLoss:c.stopLoss,takeProfit:c.target.price,
     invalidation:c.stopLoss,targetBound:c.target.price,quantity,riskUsd:distance*quantity,rr:c.rr,expiresAt:finish+3600000,evidenceIds:[c.id]};
    const block=(gates.cost?costBlock(p):null) ?? ledger.reserve(p,latestRate);if(block)count(block);else{submittedAt=finish;events.push({time:finish,type:'submitted',plan:p});}
   }
  }
  const closed=ledger.closes,wins=closed.filter(c=>c.netUsd>0),losses=closed.filter(c=>c.netUsd<0);
  const net=closed.reduce((s,c)=>s+c.netUsd,0);
  if(!ledger.holding&&Math.abs(ledger.wallet-protocol.wallet-net)>1e-7)throw Error('Cash ledger mismatch');
  const summary={split,variant,cost:slip===.001?'base':'stress',start:new Date(start).toISOString(),end:new Date(end).toISOString(),candidates:candidates.length,
   submitted:events.filter(e=>e.type==='submitted').length,fills,expired:expires,trades:closed.length,wins:wins.length,losses:losses.length,
   netCashUsd:ledger.wallet-protocol.wallet,roiEquityPercent:(ledger.equity/protocol.wallet-1)*100,meanNetUsd:closed.length?net/closed.length:null,
   profitFactor:losses.length?wins.reduce((s,c)=>s+c.netUsd,0)/-losses.reduce((s,c)=>s+c.netUsd,0):null,
   feesUsd:closed.reduce((s,c)=>s+c.feesUsd,0),fundingUsd:closed.reduce((s,c)=>s+c.fundingUsd,0),slippageUsd:closed.reduce((s,c)=>s+c.slippageUsd,0),
   maxMinuteCloseDrawdownPercent:ledger.maxDrawdownPercent,ambiguous,open:!!ledger.holding,pending:!!ledger.pending,blocks};
  summaries.push(summary);writeFileSync(out+`${split}-${variant}-${summary.cost}.json`,JSON.stringify({summary,events,equity,closes:closed},null,2));console.log(JSON.stringify(summary));
 }
}
if(JSON.stringify(initialHashes)!==JSON.stringify(hashes()))throw Error('Sources changed during run');
writeFileSync(out+'summary.json',JSON.stringify({protocol,circuit,admissionPolicy:basePolicy,summaries,sourceHashes:initialHashes,promotionEligible:false,
 limitations:['Development/revalidation on four already-inspected windows; no untouched holdout. Comparator is prior edge research model, not full live core/range/AI.',
 'Cost gate excludes funding forecasts explicitly; actual historical funding is charged. Target economics is not expected value.',
 'Fixed SL/TP plus 48h research time exit, no AI, partial fills, orderbook queue, historical filter changes or full live admission parity.',
 'Daily reversal variants intentionally have no H1 trend gate; baseline continuation retains H1. Previous day is UTC, a BTC adaptation. No OB detector or full live parity.',
 'Ambiguous minute uses conservative stop-first convention; entry-minute target-only deferred. This is not an exact execution reconstruction.',
 'Funding mark approximation follows archived dataset. Funding inside a minute processed before close at minute end.',
 'Both paths reserve at least 0.2% slippage at admission; actual charged round-trip slippage is 0.1% base / 0.2% stress. Different wallet paths may change later admissions.',
 'Minute close trade price approximates equity; intraminute and mark-price drawdown not measured.']},null,2)+'\n');
