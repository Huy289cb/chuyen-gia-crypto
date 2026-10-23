const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');require('tsx/cjs');
const bytes=fs.readFileSync(path.join(__dirname,'../dist/services/position-pnl-reconcile.service.js')),build=require('../src/utils/net-trade-statistics.ts').buildNetTradeStatistics;
(async()=>{let cases=0;const values=[-.02,-.01,0,.01,.02];const fixtures=[[],...values.map(realized_pnl=>[{realized_pnl,entry_fee:.1,exit_fee:.2,funding_fee:-.03}])];
for(const a of values)for(const b of values)for(const c of values)fixtures.push([a,b,c].map(realized_pnl=>({realized_pnl,entry_fee:.1,exit_fee:.2,funding_fee:-.03})));
for(const positions of fixtures){let write;const exports={},prisma={testnetPosition:{findMany:async()=>positions},testnetAccount:{update:async args=>{write=args.data;}},tradeOutcome:{findMany:async()=>[]}};
vm.runInNewContext(bytes.toString(),{exports,require:id=>id==='../lib/prisma'?{prisma}:id==='../repositories/testnet.repository'?{PIPELINE_EVENT_POSITION_ID:'pipeline_v3_kim_nghia'}:{},Date,console},{filename:'baseline-statistics.js'});
await exports.rebuildNetTradeStatistics(1);assert.deepEqual(JSON.parse(JSON.stringify(build(positions))),JSON.parse(JSON.stringify(write)));cases++;}
const report={deployedModuleSha256:crypto.createHash('sha256').update(bytes).digest('hex'),differentialCases:cases,exactAccountStatisticsMatch:true,liveWrites:0,limits:'Mocked deployed statistics function only; no account coverage, exchange PnL or ROI proof.'};fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
