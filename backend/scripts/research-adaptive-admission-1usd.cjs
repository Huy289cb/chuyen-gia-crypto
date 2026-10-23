// Financial admission over archived candidate fills, not a regeneration of all setup paths.
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env'});
for(const k of Object.keys(process.env))if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(k))delete process.env[k];
process.env.BINANCE_ENABLED='false';process.env.MAX_EFFECTIVE_RISK_PER_TRADE_USD='1';
const {computeExecutionRisk,resolveExecutionRiskCapUsd}=require(root+'/dist-risk-1usd/utils/execution-risk');
const {BacktestCooldownState}=require(root+'/dist-risk-1usd/backtest/cooldown-simulator');
const {getRiskPolicy}=require(root+'/dist-risk-1usd/config/risk-policy');const policy=getRiskPolicy();
const out=path.resolve(root,'../docs/audits/2026-09-07-entry-risk-1usd');
const original=path.resolve(root,'../docs/audits/2026-09-07-entry-opportunity');
const read=n=>JSON.parse(fs.readFileSync(n));
const archived=read(path.resolve(out,'../../deployments/2026-09-06-roi-fix/adaptive-backtest.json'));
const funding=read(original+'/historical-funding.json').rows;
const core=read(out+'/baseline-wallet.json').result.trades.map(t=>({...t,kind:'core',confirmedAt:t.entryTime,closedAt:t.closeTime}));
const start60=Date.parse('2026-07-08T00:00:00Z');
function run(name,inventory,slippage){
 const cooldown=new BacktestCooldownState();let wallet=34.27714639,open=null,peak=wallet,dd=0;const accepted=[],blocked=[],dayPnls=new Map();
 const day=ts=>Math.floor((ts+7*3600000)/86400000);
 function close(){if(!open)return;wallet+=open.net;peak=Math.max(peak,wallet);dd=Math.max(dd,peak-wallet);dayPnls.set(day(open.closedAt),(dayPnls.get(day(open.closedAt))||0)+open.net);cooldown.onTradeClose(open.net,open.closedAt);accepted.push({...open,balanceAfter:wallet});open=null;}
 for(const t of [...inventory].sort((a,b)=>a.confirmedAt-b.confirmedAt||a.kind.localeCompare(b.kind))){
  if(open&&open.closedAt<=t.confirmedAt)close();
  let reason=null;if(open)reason='open_position';else if(cooldown.isBlocked(t.confirmedAt))reason='cooldown';
  const qty=Math.max(.001,Math.ceil(50/t.entryPrice/.001-1e-9)*.001);
  const risk=computeExecutionRisk({entry:t.entryPrice,stopLoss:t.stopLoss,quantity:qty,balance:wallet,roundTripFeePercent:.1,slippagePercent:slippage*100});
  const dayPnl=dayPnls.get(day(t.confirmedAt))||0, dayStart=wallet-dayPnl;
  if(!reason&&(risk.totalRiskUsd>resolveExecutionRiskCapUsd({balance:wallet,maxRiskPercent:policy.maxEffectiveRiskPerTradePercent,maxRiskUsd:policy.maxEffectiveRiskPerTradeUsd})+1e-9||qty*t.entryPrice>policy.maxTotalExposureUsd))reason='execution_risk';
  if(!reason&&policy.circuitDailyLossEnabled&&risk.totalRiskUsd>dayStart*policy.dailyLossLimitPercent/100+Math.min(0,dayPnl))reason='daily_budget';
  if(reason){blocked.push({kind:t.kind,confirmedAt:t.confirmedAt,reason,riskPercent:risk.riskPercent});continue;}
  const sign=t.side==='long'?1:-1;
  const fundingCost=funding.filter(r=>t.confirmedAt<r.fundingTime&&r.fundingTime<=t.closedAt).reduce((s,r)=>s+sign*qty*Number(r.markPrice)*Number(r.fundingRate),0);
  const gross=sign*qty*(t.closePrice-t.entryPrice),fee=qty*(t.closePrice+t.entryPrice)*.0005,slippageCost=qty*t.entryPrice*slippage;
  open={kind:t.kind,side:t.side,confirmedAt:t.confirmedAt,closedAt:t.closedAt,entryPrice:t.entryPrice,closePrice:t.closePrice,quantity:qty,gross,fee,slippageCost,fundingCost,net:gross-fee-slippageCost-fundingCost,riskPercent:risk.riskPercent};
 }close();
 const gains=accepted.reduce((s,t)=>s+Math.max(0,t.net),0),losses=accepted.reduce((s,t)=>s+Math.max(0,-t.net),0);
 return {name,slippage,inventoryCount:inventory.length,summary:{count:accepted.length,net:wallet-34.27714639,profitFactor:losses?gains/losses:null,closedEquityMaxDrawdown:dd,endingWallet:wallet,blocks:blocked.reduce((a,t)=>(a[t.reason]=(a[t.reason]||0)+1,a),{})},accepted,blocked};
}
const range=archived.outcomes.filter(t=>t.kind==='range_sweep_reclaim');
const cases=[['range_180d',range],['range_60d',range.filter(t=>t.confirmedAt>=start60)],['core_plus_range_60d',[...core,...range.filter(t=>t.confirmedAt>=start60)]],['all_adaptive_180d',archived.outcomes]];
const results=[];for(const [name,trades] of cases)for(const s of [.001,.002])results.push(run(name,trades,s));
const result={computedAt:new Date().toISOString(),method:'Chronological admission on fixed archived outcomes. Recalculates wallet, fee/funding/slippage, one position, cooldown and projected daily budget. Quantity uses minimum feasible exchange lot; initial wallet 34.27714639. Outcomes suppressed by the original per-kind replay cannot reappear, so this is NOT a complete portfolio backtest or unbiased strategy estimate. Existing core inventory contains only prior baseline accepted trades. Funding applied at close while no new positions can enter; intrabar ordering approximate. Drawdown is closed equity only. Older window is historical validation, not unseen out-of-sample.',results};
fs.writeFileSync(out+'/adaptive-admission.json',JSON.stringify(result,null,2));for(const r of results)console.log(JSON.stringify({name:r.name,slippage:r.slippage,...r.summary}));
