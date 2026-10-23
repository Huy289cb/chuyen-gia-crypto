// Read-only deployment check; never creates, modifies or cancels exchange orders.
require('dotenv').config();
const fs=require('fs');
const {getPositionRisk}=require('../dist/services/binance/account');
const {getOpenOrders,getOpenAlgoOrders}=require('../dist/services/binance/trading');
const {fetchBinanceBalanceSnapshot}=require('../dist/services/binance-balance-sync.service');
const {prisma}=require('../dist/lib/prisma');
(async()=>{
 const [all,orders,algos,balance]=await Promise.all([getPositionRisk('BTCUSDT'),getOpenOrders('BTCUSDT'),getOpenAlgoOrders('BTCUSDT'),fetchBinanceBalanceSnapshot()]);
 const positions=all.filter(p=>Math.abs(Number(p.positionAmt))>1e-8);
 if(positions.length>1 || orders.length)throw Error('Unexpected exposure/order state: review required');
 if(positions.length){
  const p=positions[0],qty=Math.abs(p.positionAmt),closeSide=p.positionAmt>0?'SELL':'BUY';
  for(const type of ['STOP_MARKET','TAKE_PROFIT_MARKET']){
   const match=algos.filter(a=>a.type===type && a.side===closeSide && a.reduceOnly===true && a.status==='NEW' && Math.abs(a.quantity-qty)<1e-8);
   if(match.length!==1)throw Error('Protective order coverage unavailable: '+type);
  }
 }
 const result={checkedAt:new Date().toISOString(),positions,orders,algos,balance};
 fs.writeFileSync(process.env.OPEN_COSTS_CHECK_FILE || '../docs/deployments/2026-09-08-open-costs/exchange-before.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({checkedAt:result.checkedAt,positions:positions.length,orders:orders.length,protectiveOrders:algos.length,balance}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
