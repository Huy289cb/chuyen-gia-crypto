const assert=require('node:assert/strict'),{collectExchangeCashflows:collect}=require('./capture-exchange-cashflows.cjs');
const endpoints={INCOME:'/fapi/v1/income',ACCOUNT:'/fapi/v3/account'},iso=n=>new Date(n).toISOString(),asset={asset:'USDT',walletBalance:'30',unrealizedProfit:'0',marginBalance:'30'},account={assets:[asset],positions:[]},row=(id,time=5)=>({incomeType:'TRANSFER',asset:'USDT',income:'1',time,tranId:String(id),symbol:''});
(async()=>{
 let calls=[];const capture=await collect(async(url,params,signed)=>{calls.push({url,params,signed});return url===endpoints.ACCOUNT?account:[row('9223372036854775807'),row('2',0),{...row('3'),asset:'BNB',income:'0.01'}];},endpoints,iso(0),iso(10),()=>20);
 assert.equal(capture.income[0].time,0);assert(capture.income.some(r=>r.tranId==='9223372036854775807'));assert.equal(capture.observed_by_asset_and_type['USDT:TRANSFER'],1);assert.equal(capture.observed_by_asset_and_type['BNB:TRANSFER'],.01);assert.equal(capture.account_snapshot.terminal_equity_at_requested_cutoff,'not_established');assert.equal(capture.economic_roi,null);assert(calls.every(c=>c.signed));assert.equal(calls[0].params.symbol,undefined);
 let pages=0;const full=Array.from({length:1000},(_,i)=>row(i));const paged=await collect(async(url)=>url===endpoints.ACCOUNT?account:++pages===1?full:[row('1000')],endpoints,iso(0),iso(10),()=>20);assert.equal(paged.income.length,1001);assert.equal(paged.pages.length,2);
 await assert.rejects(()=>collect(async()=>full,endpoints,iso(0),iso(10),()=>20),/no_progress/);
 await assert.rejects(()=>collect(async()=>[row('1'),{...row('1'),income:'2'}],endpoints,iso(0),iso(10),()=>20),/conflicting_income_identity/);
 await assert.rejects(()=>collect(async()=>[{...row('1'),tranId:Number.MAX_SAFE_INTEGER+1}],endpoints,iso(0),iso(10),()=>20),/invalid_income_row/);
 let queried=false;await assert.rejects(()=>collect(async()=>{queried=true;return [];},endpoints,iso(0),iso(21),()=>20),/invalid_bounded_window/);assert.equal(queried,false);
 const empty=await collect(async(url)=>url===endpoints.ACCOUNT?account:[],endpoints,iso(0),iso(10),()=>20);assert.deepEqual(empty.observed_by_asset_and_type,{});assert.equal(empty.capital_flow_coverage,'not_established');
 console.log('Seven collector checks pass: int64/assets/boundary, pagination, no-progress, identity conflict, unsafe ID, future window, empty unknown.');
})().catch(e=>{console.error(e);process.exitCode=1;});
