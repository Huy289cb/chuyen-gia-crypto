/** Offline bridge to existing account engine. Does not import runtime schedulers/DB. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runIctTimeline} from './ict-account-timeline';
const out='../docs/audits/2026-09-15-ict-opportunities/';
const read=(name:string)=>JSON.parse(readFileSync(out+name,'utf8'));
async function main(){
 // Pin the user's policy in this offline process, without changing .env or PM2.
 Object.assign(process.env,{MAX_EFFECTIVE_RISK_PER_TRADE_USD:'',MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',DAILY_LOSS_LIMIT_PERCENT:'10',CONSECUTIVE_LOSS_COOLDOWN_HOURS:'1',LOSS_COOLDOWN_TIER2_HOURS:'1',LOSS_COOLDOWN_TIER3_HOURS:'1',LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY:'false'});
 const {ReplayAccount}=await import('../src/backtest/replay-account');
 const {computeExecutionRisk}=await import('../src/utils/execution-risk');
 const context=read('account-context.json'), candidates=read('detector-results.json').candidates;
 const results=read('funded-replay-results.json').results;
 const snap=context.baseline.startSnapshot;if(!snap||snap.open_positions_count!==0)throw Error('Missing flat initial account state');
 const wallet=snap.balance;const risk=context.risk;
 if(risk.maxRiskPercent!==3||risk.maxRiskUsd!==null||risk.dailyLossPercent!==10||risk.targetRiskPercent!==.5)throw Error('Unexpected pinned risk policy');
 const lot=context.filters.filters.find((x:any)=>x.filterType==='LOT_SIZE');const notional=context.filters.filters.find((x:any)=>x.filterType==='MIN_NOTIONAL');
 if(Number(lot.stepSize)!==.001||Number(lot.minQty)!==.001||Number(notional.notional)!==50)throw Error('Account engine filter mismatch');
 const exposure=Math.min(risk.maxExposureUsd,risk.maxExposurePercentOfEquity?wallet*risk.maxExposurePercentOfEquity/100:Infinity);
 const funding=context.funding.rows.map((x:any)=>({time:x.timestamp,rate:x.rate,markPrice:x.markPrice}));
 const options=(slip:number)=>({initialWallet:wallet,maxRiskUsd:null,maxRiskPercent:3,targetRiskPercent:.5,maxExposureUsd:exposure,dailyLossPercent:10,feePerSide:.0005,slippageFraction:slip,funding,postCloseCooldown:{winMinutes:60,lossMinutes:60}});
 const baselineTrades=context.baseline.positions.filter((p:any)=>p.size_qty>0&&['long','short'].includes(p.side.toLowerCase()));
 const artifacts=context.baseline.positions.filter((p:any)=>p.size_qty<=0);
 const probes=candidates.map((c:any)=>{const account=new ReplayAccount(options(.001));const admission=account.tryOpen({key:c.id,side:c.side,entry:c.entry,stopLoss:c.stopLoss,time:c.confirmedAt+1});return {id:c.id,role:'isolated initial-wallet sizing probe, not full live admission',admission,totalRiskUsd:admission.accepted?computeExecutionRisk({entry:c.entry,stopLoss:c.stopLoss,quantity:admission.quantity,balance:wallet,roundTripFeePercent:.1,slippagePercent:.1}).totalRiskUsd:null,capUsd:wallet*.03}});
 const base=runIctTimeline(candidates,results,options(.001)),stress=runIctTimeline(candidates,results,options(.002));
 const report={initialWallet:wallet,initialSnapshot:snap,filterSnapshotHistorical:false,probes,fundingRecords:funding.length,base,stress,fills:base.log.filter(e=>e.state==='filled').length,portfolioRoi:null,baseline:{actualPositions:baselineTrades,excludedArtifacts:artifacts.map((x:any)=>x.position_id),pending:context.baseline.pending,incrementalFilledTrades:0,netExpectancy:null},limitations:['No filled ICT candidates: integration validates zero-activity ledger and isolated sizing only.','Chronological adapter handles pending, fill, exit, cooldown; unresolved outcomes stop evaluation. Full live admission parity remains unverified.','Filters and risk are current snapshots, not reconstructed historical exchange settings.','No strategy ROI or profitable edge established; baseline rejected-candidate history not reconstructed.','Account-engine cost scenarios are 0.1%/0.2% total slippage; diagnostic v1 used exit-only 0.05%/0.1%. Do not mix filled outcomes.'],hashes:Object.fromEntries(['../src/backtest/replay-account.ts','../src/backtest/cooldown-simulator.ts','../src/config/risk-policy.ts','../src/utils/execution-risk.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p.replace('../src/','src/'))).digest('hex')]))};
 writeFileSync(out+'account-audit.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
