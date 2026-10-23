/* Executes ONLY the packaged modules in a closed VM with mocked DB/exchange. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('typescript');
const pkg=path.resolve(process.argv[2]||'releases/measurement-20260914');
const manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json')));
const sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
let checks=0;
for(const variant of ['baseline','release'])for(const [file,hash] of Object.entries(manifest[variant])) {
  const filename=path.join(pkg,variant,file);assert.equal(sha(fs.readFileSync(filename)),hash);
  if(file.endsWith('.js')) {
    const source=fs.readFileSync(filename,'utf8');new vm.Script(source,{filename});
    for(const [,req] of source.matchAll(/require\(['"]([^'"]+)['"]\)/g))if(req.startsWith('.')) {
      const target=path.resolve(path.dirname(filename),req);
      assert([target,target+'.js',target+'.json',path.join(target,'index.js')].some(p=>fs.existsSync(p)),`${file}: missing ${req}`);
    }
  }
}
checks++;
const clean=x=>JSON.parse(JSON.stringify(x));
function stripMetadata(x) {
  if(Array.isArray(x))return x.map(stripMetadata);
  if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>!['rejectionCode','code','trace'].includes(k)).map(([k,v])=>[k,stripMetadata(v)]));
  return x;
}
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
function canonicalExecutor(source) {
 const tree=ts.createSourceFile('module.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const result=ts.transform(tree,[ctx=>{const visit=node=>{
  if(ts.isExpressionStatement(node)&&node.getText(tree).startsWith('await (0, entry_trace_1.recordEntryStage)'))return undefined;
  return ts.visitEachChild(node,visit,ctx);
 };return n=>ts.visitNode(n,visit);}]);
 const printed=ts.createPrinter({removeComments:true}).printFile(result.transformed[0]);result.dispose();return printed;
}
const baseExecutor=fs.readFileSync(path.join(pkg,'baseline/services/v3-trade-execution.service.js'),'utf8');
const selectedExecutor=fs.readFileSync(path.join(pkg,'release/services/v3-trade-execution.service.js'),'utf8');
assert.equal(canonicalExecutor(selectedExecutor),canonicalExecutor(baseExecutor),'Non-telemetry executor logic changed');checks++;
assert.deepEqual(manifest.changedFiles,['services/v3-trade-execution.service.js']);
async function execution(variant,scenario) {
  const writes=[],events=[];
  const risk={riskPerTradePercent:.5,minSlDistancePercent:.008,maxFeePercent:.1,maxSlippagePercent:.1,
    maxEffectiveRiskPerTradePercent:3,maxEffectiveRiskPerTradeUsd:null,maxPositionsPerSymbol:1,circuitDailyLossEnabled:true};
  const mocks={
    'config/methods':{getMethodConfig:()=>({autoEntry:{minSLDistancePercent:.008,minRRRatio:3}})},
    'config/risk-policy':{getRiskPolicy:()=>risk},
    'repositories/testnet.repository':{
      getOrCreateTestnetAccount:async()=>({id:1,current_balance:scenario.balance??33.6}),
      getActiveTestnetPositions:async()=>scenario.open?[{side:'long'}]:[],getBlockingTestnetPendingOrders:async()=>[],
      createTestnetPendingOrder:async x=>writes.push(['pending',clean(x)]),
      recordPipelineEvent:async(type,data)=>{events.push([type,clean(data)]);return 1;},
      recordSilentPipelineEvent:async(type,data)=>{events.push([type,clean(data)]);return 1;},
    },
    'services/account-risk-guard.service':{assertTestnetAccountCanOpenTrade:async()=>({allowed:!scenario.blockAccount,reason:'account blocked',remainingDailyRiskUsd:scenario.daily??3.36})},
    'services/binance-account-health.service':{checkBinanceAccountTradable:async()=>({tradable:true})},
    'services/opposite-flip.service':{tryOppositeFlipBeforeEntry:async()=>{throw Error('unexpected flip');}},
    'services/v3-entry-eligibility.service':{
      assertScaleInSideAllowed:async()=>null,assertSameSidePostCloseCooldown:async()=>scenario.cooldown?'cooldown':null,
      oppositeLocalSide:s=>s==='long'?'short':'long',getSymbolExposureSnapshot:async()=>({totalUsd:0,maxExposureUsd:100,remainingUsd:scenario.exposure??100,openUsd:0}),
    },
    'services/binance-hedge-mode':{ensurePositionModeDetected:async()=>{}},
    'services/binanceClient':{initTestnetClient:()=>({}),normalizeQuantityForSymbol:async()=>({stepSize:.001,minQty:.001}),
      placeLimitOrder:async(...args)=>{writes.push(['exchange',clean(args)]);return {orderId:123};}},
    'services/telegram/telegram-hooks':{hookPendingOrderPlaced:()=>{}},
  };
  const load=sandbox(variant,mocks);
  const analysis=scenario.analysis??{action:'buy',suggested_entry:77000,suggested_stop_loss:76384,suggested_take_profit:78848,expected_rr:3};
  const result=await load('services/v3-trade-execution.service').executeV3Trade({symbol:'BTC',timeframe:'15m',analysis,decisionRecordId:997});
  return {result:stripMetadata(clean(result)),writes,events};
}

async function main(){
  const baseQuantity=sandbox('baseline')('utils/order-quantity'),selectedQuantity=sandbox('release')('utils/order-quantity');
  for(const quantity of [0,.0001,.001,.0018,NaN])for(const capacity of [0,50,100])for(const step of [.001,0]) {
    const input={quantity,entryPrice:77000,minNotionalUsd:50,stepSize:step,minQty:.001,maxNotionalUsd:capacity};
    assert.deepEqual(clean(selectedQuantity.resolveQuantityForMinNotional(input)),clean(baseQuantity.resolveQuantityForMinNotional(input)));checks++;
  }
  const scenarios=[{}, {balance:1},{exposure:50},{daily:.2},{open:true},{cooldown:true},{blockAccount:true},
    {analysis:{action:'sell',suggested_entry:76442.3,suggested_stop_loss:76950,suggested_take_profit:75900}},
    {analysis:{action:'buy',suggested_entry:77000,suggested_stop_loss:76384,suggested_take_profit:77500}},
    {analysis:{action:'sell',suggested_entry:77000,suggested_stop_loss:77616,suggested_take_profit:75152}},
  ];
  for(const scenario of scenarios){
    const a=await execution('baseline',scenario),b=await execution('release',scenario);
    assert.deepEqual(b.result,a.result);assert.deepEqual(b.writes,a.writes);assert(b.events.some(([type])=>type==='entry_trace'));
    const recorded=b.events.filter(([type,d])=>type==='entry_trace'&&['quantity_checked','risk_checked'].includes(d.stage));
    for(const [,d]of recorded)assert.equal(d.admission_schema,'financial-inputs-v1');
    if(b.result.success)assert.equal(recorded.length,2);checks++;
  }
  const result={checks,syntaxAndDependencyClosure:true,executorControlAstEquivalent:true,quantityCases:30,
    executorCases:scenarios.length,funnelCases:0,exchangeAndDbMocked:true,liveOrdersSent:0};
  fs.writeFileSync(path.join(pkg,'parity-tests.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
