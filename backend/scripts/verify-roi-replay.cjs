const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
require(root + '/node_modules/dotenv').config({ path: root + '/.env' });
for (const key of Object.keys(process.env)) if (/API_KEY|API_SECRET|DATABASE_URL|DIRECT_URL|TOKEN/.test(key)) delete process.env[key];
process.env.BINANCE_ENABLED = 'false';
const build = process.env.ROI_VERIFY_BUILD || 'dist-candidate';
const out = path.resolve(root, '../docs/deployments/2026-09-06-roi-fix');
const loader = require(root + '/' + build + '/backtest/candle-loader');
const load = loader.loadBacktestCandles, cache = new Map();
loader.loadBacktestCandles = async options => {
  const key = JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, await load(options));
  return cache.get(key);
};
const variants = require(root + '/' + build + '/config/testbed-variants').TESTBED_VARIANTS;
variants['roi-shadow-pb050'] = { id: 'roi-shadow-pb050', label: 'Pullback 0.50% research only', enableCooldown: true,
  pullbackMaxAbovePct: 0.5, breakoutPullbackMaxAbovePct: 0.5 };
const { runHistoricalTestbed } = require(root + '/' + build + '/backtest/historical-testbed.service');
const { runAdaptiveSetupReplay } = require(root + '/' + build + '/backtest/adaptive-setup-replay');
const end = new Date('2026-09-06T00:00:00Z');
function summary(trades) {
  const positive = trades.filter(t => t.pnlUsd > 0).reduce((s,t)=>s+t.pnlUsd,0);
  const negative = -trades.filter(t => t.pnlUsd < 0).reduce((s,t)=>s+t.pnlUsd,0);
  let equity=0,peak=0,dd=0; for (const t of trades) { equity+=t.pnlUsd; peak=Math.max(peak,equity); dd=Math.max(dd,peak-equity); }
  return { count:trades.length, net:equity, profitFactor:negative ? positive/negative : null, maxDrawdownUsd:dd,
    forcedEndCloses:trades.filter(t=>t.closeReason==='end_of_data').length };
}
(async()=>{
  const core=[];
  for (const variant of ['baseline', 'roi-shadow-pb050']) {
    for (const wallet of [null, 34.27714639]) {
      const result = await runHistoricalTestbed({ symbol:'BTC', days:60, endDate:end, notionalUsd:100,
        feePctPerSide:0.0005, slippagePct:0.001, variant, ...(wallet ? {executionWalletUsd:wallet} : {}) });
      const item = { variant, executionWalletUsd:wallet, summary:summary(result.trades), result };
      core.push(item); fs.writeFileSync(out+'/core-backtest.json',JSON.stringify(core,null,2));
      console.log(JSON.stringify({variant,wallet,summary:item.summary,executionBlocks:result.blocks.execution_risk}));
    }
  }
  cache.clear();
  const start = new Date(end.getTime()-180*86400000);
  const loaded = await load({symbol:'BTC',weeks:26,timeframes:['5m','15m','1h','4h'],startDate:start,endDate:end,extraWarmupBarsPerTf:150});
  const adaptive=await runAdaptiveSetupReplay({symbol:'BTC',byTf:loaded.byTf,start,end});
  fs.writeFileSync(out+'/adaptive-backtest.json',JSON.stringify(adaptive,null,2));
  console.log(JSON.stringify({adaptive180d:adaptive.byKind}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
