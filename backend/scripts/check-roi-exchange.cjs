require('dotenv').config();
const build = process.env.ROI_VERIFY_BUILD || 'dist-candidate';
const trading = require('../'+build+'/services/binance/trading');
const {fetchBinanceBalanceSnapshot} = require('../'+build+'/services/binance-balance-sync.service');
const {fetchActiveBinancePositions} = require('../'+build+'/services/binance-exposure.service');
const {prisma} = require('../'+build+'/lib/prisma');
(async()=>{
 const balance=await fetchBinanceBalanceSnapshot();
 const positions=await fetchActiveBinancePositions('BTC');
 const orders=await trading.getOpenOrders('BTCUSDT');
 const algo=await trading.getOpenAlgoOrders('BTCUSDT');
 const result={checkedAt:new Date().toISOString(),balance,positions:positions.length,orders:orders.length,algoOrders:algo.length};
 require('fs').writeFileSync('../docs/deployments/2026-09-06-roi-fix/exchange-predeploy.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 if(positions.length||orders.length||algo.length)process.exitCode=2;
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
