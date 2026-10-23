const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const pkg=path.resolve(process.argv[2]);
const clean=x=>JSON.parse(JSON.stringify(x));
const fixed=Date.UTC(2026,8,14,3,50,10);
class Clock extends Date {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
const env={NODE_ENV:'test',BINANCE_ENABLED:'true',MIN_SL_DISTANCE_PERCENT:'.008',MIN_RR_RATIO:'3',
  RISK_PER_TRADE_PERCENT:'.5',MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',MAX_EFFECTIVE_RISK_PER_TRADE_USD:'',
  DAILY_LOSS_LIMIT_PERCENT:'10',MAX_TOTAL_EXPOSURE_USD:'100',V3_SCALE_IN_ENABLED:'false',V3_OPPOSITE_FLIP_ENABLED:'false'};
function sandbox(variant,mocks={}) {
  const root=path.join(pkg,variant),cache=new Map();
  function load(name){
    name=name.replace(/\.js$/,'');if(name in mocks)return mocks[name];if(cache.has(name))return cache.get(name).exports;
    const file=path.join(root,name+'.js'),module={exports:{}};cache.set(name,module);
    const req=id=>{
      if(id.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),id)));
      if(['node:async_hooks','node:crypto','node:fs','node:path'].includes(id))return require(id);
      throw new Error('Unexpected external dependency '+id+' from '+name);
    };
    const context={module,exports:module.exports,require:req,__dirname:path.dirname(file),__filename:file,
      process:{env:{...env},pid:123},Date:Clock,Math:Object.assign(Object.create(Math),{random:()=>.125}),
      console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,AbortSignal,structuredClone,
      fetch(){throw new Error('Network disabled in release tests');}};
    vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});return module.exports;
  }return load;
}
async function funnel(variant,side,blocked,missing) {
  const end=fixed-10000;
  const candles=Array.from({length:30},(_,i)=>({timestamp:end-(30-i)*900000,open:100,high:102,low:98,close:100,volume:100}));
  const policy={resolveGateRegimeFromSignal:()=> 'trend',isRangeEntryBlocked:()=>false,
    evaluateSetupGradePlaybookFilter:()=>({pass:true}),getV3RequireHtfTrend:()=>false,isV3RequireHtfSideAlign:()=>false,
    isV3RequirePullback:()=>true,getV3PullbackTf:()=> '15m',getV3PullbackSmaPeriod:()=>20,
    getV3BreakoutPullbackMaxAbovePct:()=>.25,getV3PullbackMaxAbovePct:()=>.25,getV3PullbackMaxBelowPct:()=>.25,
    evaluateTrendPullbackEntry:()=>({pass:!blocked,sma:100}),evaluate5mEntryGuards:()=>({pass:true})};
  const load=sandbox(variant,{
    'config/v3-entry-policy':policy,'config/risk-policy':{getRiskPolicy:()=>({minSlDistancePercent:.008})},
    'config/methods':{getMethodConfig:()=>({autoEntry:{minRRRatio:3}})},
    'config/v3-structure-bias-policy':{isV3StructureBiasEnabled:()=>true,getV3StructureBiasTf:()=> '4h',getV3StructureBiasCandleLimit:()=>40,
      evaluateStructureSidePermission:()=>({pass:true,bias:side==='short'?'bear':'bull'})},
    'services/candle.service':{getCandles:async()=>{if(missing)throw Error('missing');return {candles};}},
    'config/funding-veto':{isFundingVetoEnabled:()=>false},'services/binance/market':{},
    'utils/setup-trade-side':{inferSetupTradeSide:()=>side},'utils/scan-freshness':{},
    'services/v3-entry-eligibility.service':{canRunLlmDispatchForSymbol:async()=>({allowed:true})},
    'repositories/testnet.repository':{},
  });
  return clean(await load('services/entry-gate-funnel.service').evaluateEntryGateFunnel({symbol:'BTC',timeframe:'15m',candles,
    signalResult:{pass:!!side,reason:'fixture',setupResult:{grade:side?'A':'D',confidence:.8,regime:'trend',playbookKey:side?'breakout_volume':'unknown',evidence:{playbooks:[]}}},getScan:()=>undefined}));
}

(async()=>{let cases=0;for(const side of [null,'long','short'])for(const blocked of [true,false])for(const missing of [true,false]){
 const a=await funnel('baseline',side,blocked,missing),b=await funnel('release',side,blocked,missing);
 for(const key of Object.keys(a))assert.deepStrictEqual(b[key],a[key],key);
 assert.equal(b.setup_identity.status,'unknown');cases++;
}console.log(JSON.stringify({cases,funnelLegacyFieldsParity:true,exchangeAndDatabaseMocked:true}));})().catch(e=>{console.error(e);process.exitCode=1;});
