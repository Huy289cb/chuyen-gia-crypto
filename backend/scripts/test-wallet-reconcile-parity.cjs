const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');require('tsx/cjs');
const root=path.resolve(__dirname,'..'),file=path.join(root,'dist/services/wallet-reconcile.service.js'),bytes=fs.readFileSync(file);
const {buildWalletReconcileUpdate:build}=require('../src/utils/wallet-reconcile-update.ts');
(async()=>{let cases=0;const now=new Date('2026-10-02T13:35:00Z');
for(const positions of [[],[{realized_pnl:null,entry_fee:0,exit_fee:0,funding_fee:0}],[{realized_pnl:-2,entry_fee:.1,exit_fee:.2,funding_fee:-.03}],[{realized_pnl:1,entry_fee:.05,exit_fee:.02,funding_fee:.03},{realized_pnl:-.01,entry_fee:.01,exit_fee:.01,funding_fee:-.02}]])for(const balance of [0,30,100]){
 let written;const exports={},snapshot={walletBalance:balance+1,equity:balance+2,unrealizedPnl:1};
 const mocks={'../lib/prisma':{prisma:{testnetAccount:{findUnique:async()=>({starting_balance:balance,realized_pnl:0}),update:async arg=>{written=arg.data;}},testnetPosition:{findMany:async()=>positions}}},'../repositories/testnet.repository':{PIPELINE_EVENT_POSITION_ID:'pipeline_v3_kim_nghia'},'./binance-balance-sync.service':{fetchBinanceBalanceSnapshot:async()=>snapshot},'./binance-income.service':{fetchBinanceIncomeSummary:async()=>({netTradingPnl:1,realizedPnl:1,transferNet:0,commission:0,fundingFee:0,rowCount:1})},'./binance-account-health.service':{isBinanceDemoMetadataUnavailableError:()=>false}};
 const fixedDate=class extends Date{constructor(...args){super(...(args.length?args:[now.getTime()]));}};
 vm.runInNewContext(bytes.toString(),{exports,require:id=>{if(Object.hasOwn(mocks,id))return mocks[id];throw Error('unmocked '+id);},Date:fixedDate,console:{log(){}}},{filename:file});
 await exports.reconcileTestnetWalletFromBinance(1);
 assert.deepEqual(JSON.parse(JSON.stringify(build(balance,snapshot,positions,now))),JSON.parse(JSON.stringify(written)));cases++;
}
const report={compiledBaselineSha256:crypto.createHash('sha256').update(bytes).digest('hex'),differentialCases:cases,exactSerializedAccountWritesMatch:true,liveQueriesOrWrites:0,limits:'Mocked deployed reconciliation writes versus shared arithmetic; no exchange/ledger/portfolio proof.'};fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
