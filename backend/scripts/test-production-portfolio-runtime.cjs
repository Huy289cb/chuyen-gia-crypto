'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{PrismaClient}=require('@prisma/client');
const {createProductionPortfolioRuntime}=require('./production-portfolio-runtime.cjs');
const out=path.resolve(process.argv[2]??'');if(!process.argv[2]||fs.existsSync(out))throw Error('NEW_PROOF_DIRECTORY');
const testUrl=process.env.ROI_ATOMIC_TEST_DATABASE_URL;if(!testUrl)throw Error('explicit_isolated_database_required');
const parsed=new URL(testUrl);if(parsed.hostname!=='127.0.0.1'||parsed.port!=='55439'||parsed.pathname!=='/crypto_reset_test')throw Error('refusing_nonisolated_database');
const schema='engine_'+path.basename(out).replace(/[^a-zA-Z0-9_]/g,'_');parsed.searchParams.set('schema',schema);
fs.mkdirSync(out,{recursive:true,mode:0o700});let db,runtime;
const sourceHash=file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const proof={source_hashes:Object.fromEntries(['production-portfolio-runtime.cjs','test-production-portfolio-runtime.cjs'].map(file=>[file,sourceHash(path.join(__dirname,file))])),schema:'production-portfolio-runtime-proof-v1',started_at:new Date().toISOString(),isolated_storage_schema:schema,production_touched:false,raw_exchange_inputs:'synthetic',provider_calls:0,results:[],full_historical_baseline_parity:false,economic_roi:null};
(async()=>{
 const url=parsed.toString(),env={...process.env,DATABASE_URL:url};for(const k of ['NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE','NODE_UNIQUE_ID'])delete env[k];
 const setup=cp.spawnSync(path.resolve(__dirname,'../node_modules/.bin/prisma'),['db','push','--skip-generate'],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8',timeout:60000});proof.storage_setup_exit=setup.status;if(setup.status!==0)throw Error('isolated_schema_setup_failed');
 db=new PrismaClient({datasources:{db:{url}}});assert.equal(await db.testnetAccount.count(),0,'fixture namespace must be fresh');
 const base=Date.now()+1000;let clockReads=0;const readClock=at=>at+(clockReads++);proof.clock_basis='synthetic_monotonic_command_clock_not_historical_publication';let wallet=40,quantity=0,nextOrder=1000,ackQty='0';const fills=[];
 const noHook=()=>{};
 const adapters={
  'services/binanceClient':{initTestnetClient:()=>({replay:true}),getSymbolMinNotional:async()=>50,normalizeQuantityForSymbol:async()=>({minQty:.001,stepSize:.001}),placeLimitOrder:async()=>({orderId:++nextOrder}),cancelOrder:async(_client,symbol,orderId)=>({symbol,orderId,status:'CANCELED',executedQty:ackQty}),getAccountBalance:async()=>({totalWalletBalance:String(wallet)})},
  'services/binance-hedge-mode':{ensurePositionModeDetected:async()=>{},isHedgeMode:()=>false},
  'services/binance-account-health.service':{checkBinanceAccountTradable:async()=>({tradable:true}),isBinanceDemoMetadataUnavailableError:()=>false},
  'services/binance-exposure.service':{hasBinanceExposureForSide:async(_symbol,side)=>side==='long'&&quantity>0,fetchActiveBinancePositions:async()=>quantity?[{symbol:'BTC',side:'long',positionAmt:quantity}]:[],fetchBinanceNetPosition:async()=>quantity?{symbol:'BTC',side:'long',positionAmt:quantity,markPrice:64000}:null},
  'services/binance-trade-history.service':{getBinanceLossStreak:async()=>({consecutiveLosses:0,lastLossTime:0}),fetchUserTradesByTimeWindows:async()=>fills},
  'services/binance-income.service':{fetchBinanceIncomeRows:async()=>[]},
  'services/binance/account':{getAccount:async()=>({assets:[{asset:'USDT',walletBalance:wallet}],totalWalletBalance:wallet,totalUnrealizedProfit:0,totalMarginBalance:wallet})},
  'services/telegram/telegram-hooks':{hookPendingOrderPlaced:noHook,hookPendingCancelled:noHook,hookEntryFilled:noHook},
  'services/telegram/telegram-notify.service':{notifyFromTradeEvent:async()=>{}},
  'services/memory.service':{},
  protection:{placeProtectiveOrdersForPosition:async()=>({slPlaced:true,tpPlaced:true})},
 };
 const environment={BINANCE_MIN_ORDER_NOTIONAL_USD:'50',NOTIONAL_TOLERANCE_PERCENT:'0',BINANCE_ENABLED:'true',BINANCE_TESTNET:'true',MAX_EFFECTIVE_RISK_PER_TRADE_USD:'',MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT:'3',DAILY_LOSS_LIMIT_PERCENT:'10',MIN_SL_DISTANCE_PERCENT:'0.008',RISK_PER_TRADE_PERCENT:'0.5',MAX_TOTAL_EXPOSURE_USD:'100',POST_CLOSE_SAME_SIDE_COOLDOWN_MINUTES:'60',POST_LOSS_SAME_SIDE_COOLDOWN_MINUTES:'60',PENDING_ORDER_REENTRY_COOLDOWN_MINUTES:'60',MAX_CONSECUTIVE_LOSSES:'2',CONSECUTIVE_LOSS_COOLDOWN_HOURS:'1',LOSS_COOLDOWN_TIER2_HOURS:'1',LOSS_COOLDOWN_TIER3_HOURS:'1',LOSS_COOLDOWN_TIER3_UNTIL_UTC_DAY:'false',CIRCUIT_EXPECTANCY_COOLDOWN_HOURS:'1',CIRCUIT_DRAWDOWN_ENABLED:'true',V3_SCALE_IN_ENABLED:'false',V3_OPPOSITE_FLIP_ENABLED:'true'};
 const account=await db.testnetAccount.create({data:{symbol:'BTC',method_id:'kim_nghia',starting_balance:40,current_balance:40,equity:40}});
 proof.environment=environment;
 proof.initial_seed=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const read=await tx.testnetAccount.findUnique({where:{id:account.id}});
  return {schema:'prospective-account-state-v1',source:'SELECT_only_repeatable_read',read_started_at:new Date(base-2).toISOString(),known_at:new Date(base-1).toISOString(),account:read,positions:[],pending:[],fixture:true,clock_basis:'injected_runtime_clock',production:false};
 },{isolationLevel:'RepeatableRead'});
 runtime=createProductionPortfolioRuntime({runtimeRoot:path.resolve(__dirname,'../dist'),database:db,environment,externalAdapters:adapters,readClock,initialClock:base});
 const input={symbol:'BTC',timeframe:'5m',methodId:'kim_nghia',analysis:{action:'buy',suggested_entry:64000,suggested_stop_loss:63400,suggested_take_profit:66000,invalidation_level:63420,expected_rr:3.333}};
 async function step(command){const result=await runtime.step(command);proof.results.push(result);return result;}
 const eligibility=await step({kind:'eligibility',at:base,symbol:'BTC',methodId:'kim_nghia'});assert.equal(eligibility.result.allowed,true,eligibility.result.reason);
 const first=await step({kind:'execute',at:base+1000,input});assert.equal(first.result.success,true,first.result.reason);assert.equal(first.state.pending.length,1);
 const duplicate=await step({kind:'execute',at:base+2000,input});assert.equal(duplicate.result.success,false);assert.equal(duplicate.state.pending.length,1);
 const order=first.state.pending[0];quantity=.001;wallet-=.032;
 fills.push({tradeId:1,orderId:order.binance_order_id,side:'BUY',price:64000,qty:.001,commission:.032,commissionAsset:'USDT',realizedPnl:0,time:base+3000});
 const fill=await step({kind:'fill',at:base+3000,orderId:order.order_id,executedQty:.001,avgPrice:64000});assert.equal(typeof fill.result,'string');assert.equal(fill.state.positions.filter(p=>p.status==='open').length,1);assert.equal(fill.state.pending[0].status,'executed');
 const position=fill.state.positions.find(p=>p.position_id===fill.result);
 const occupied=await step({kind:'execute',at:base+4000,input});assert.equal(occupied.result.success,false);
 fills.push({tradeId:2,orderId:'final',side:'SELL',price:66000,qty:.001,commission:.033,commissionAsset:'USDT',realizedPnl:2,time:base+5000});quantity=0;wallet=41.935;
 const closed=await step({kind:'close',at:base+6000,positionId:position.position_id,price:66000,reason:'manual_close'});assert(Math.abs(closed.result-1.935)<1e-9);const closedAccount=closed.state.accounts.find(a=>a.id===account.id);assert.equal(closedAccount.total_trades,1);assert(Math.abs(closedAccount.current_balance-wallet)<1e-9);assert(Math.abs(closedAccount.realized_pnl-1.935)<1e-9);
 const cooldown=await step({kind:'execute',at:base+7000,input});assert.equal(cooldown.result.success,false);assert.match(cooldown.result.reason,/cooldown|post.close/i);
 const repeated=await step({kind:'close',at:base+8000,positionId:position.position_id,price:66000,reason:'manual_close'});assert.equal(repeated.result,0);assert.equal(repeated.state.accounts.find(a=>a.id===account.id).total_trades,1);
 const next=await step({kind:'execute',at:base+3607000,input});assert.equal(next.result.success,true,next.result.reason);
 const cancelled=await step({kind:'cancel',at:base+3608000,orderId:next.result.orderId,reason:'manual'});assert.match(cancelled.state.pending.find(p=>p.order_id===next.result.orderId).status,/cancelled/);
 const cancelCooldown=await step({kind:'eligibility',at:base+3609000,symbol:'BTC',methodId:'kim_nghia'});assert.equal(cancelCooldown.result.allowed,false);assert.match(cancelCooldown.result.reason,/cooldown|cancel/i);
 const last=await step({kind:'execute',at:base+7210000,input});assert.equal(last.result.success,true,last.result.reason);
 ackQty='.0005';let rejected=false;try{await step({kind:'cancel',at:base+7211000,orderId:last.result.orderId,reason:'manual'});}catch(e){rejected=e.message==='pending_cancel_requires_reconciliation';proof.results.push({kind:'cancel_nonzero_fill',error:e.message,state:await runtime.snapshot()});}assert(rejected);assert.equal((await db.testnetPendingOrder.findUnique({where:{order_id:last.result.orderId}})).status,'pending');
 const incompleteAdapters={...adapters,'services/binance-exposure.service':{...adapters['services/binance-exposure.service']}};
 delete incompleteAdapters['services/binance-exposure.service'].hasBinanceExposureForSide;
 const incomplete=createProductionPortfolioRuntime({runtimeRoot:path.resolve(__dirname,'../dist'),database:db,environment,externalAdapters:incompleteAdapters,readClock,initialClock:base+7211000});
 const beforeCount=await db.testnetPendingOrder.count();let boundaryRejected=false;
 try{await incomplete.step({kind:'execute',at:base+7212000,input});}catch(e){boundaryRejected=e.message==='incomplete_external_adapter_boundary';}
 assert(boundaryRejected);assert.equal(await db.testnetPendingOrder.count(),beforeCount);proof.missingAdapterRejectedWithoutNewOrder=true;
 proof.persisted_events=await db.testnetTradeEvent.findMany({orderBy:{id:'asc'}});proof.diagnostics=runtime.diagnostics();
 const since=proof.initial_seed.known_at,through=proof.results.at(-1).state.at;
 const telemetry={schema:'upgrade-telemetry-export-v2',since,through,snapshot_observed_at:through,availability_basis:'isolated_postgresql_fixture_injected_clock_not_production',events:proof.persisted_events.filter(e=>Date.parse(e.timestamp)<=Date.parse(through)).map(e=>({...e,event_data:JSON.parse(e.event_data)})),source:'Actual compiled handlers/repository with isolated PostgreSQL and synthetic exchange inputs',fixture:true};
 const provider={schema:'independent-provider-export-v1',since,through,events:[],source_table:'fixture.not_production',fixture:true};
 for(const [name,value]of Object.entries({'telemetry.json':telemetry,'seed.json':proof.initial_seed,'provider.json':provider}))fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 const canonical=cp.spawnSync(process.execPath,[path.join(__dirname,'run-canonical-portfolio-replay.cjs'),path.join(out,'telemetry.json'),path.join(out,'canonical.json'),path.join(out,'provider.json'),path.join(out,'seed.json')],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:60000});proof.canonical_exit=canonical.status;if(canonical.status!==0)throw Error('canonical_fixture_failed');
 const composed=JSON.parse(fs.readFileSync(path.join(out,'canonical.json')));assert.equal(composed.baseline.economic_roi_base,null);assert.equal(composed.baseline_input_bundle.status,'insufficient');
 assert(Math.abs(composed.observed_close_ledger.observed_net_close_subtotal-1.935)<1e-9);assert.equal(composed.observed_close_ledger.unknown_rows,0);proof.canonicalObservedCloseMatches=true;
 assert.deepEqual(composed.local_materialization_projection.unknown,[]);
 const projected=composed.local_materialization_projection;
 for(const row of proof.results.at(-1).state.pending){const replayed=projected.pending.find(p=>p.order_id===row.order_id);assert(replayed);for(const key of ['status','account_id','side','size_qty','size_usd','entry_price','stop_loss','take_profit','risk_usd'])assert.equal(replayed[key],row[key],key);}
 const stateAccount=proof.results.at(-1).state.accounts.find(a=>a.id===account.id),observedAccount=composed.account_timeline.accounts.find(a=>a.account_id===account.id);assert(observedAccount.latest_observed_fields);
 for(const key of ['current_balance','equity','realized_pnl','total_trades','winning_trades','losing_trades','consecutive_losses'])assert.equal(observedAccount.latest_observed_fields[key],stateAccount[key],key);
 proof.canonicalInventoryAndAccountFieldsMatchActualStorage=true;
 assert.equal(proof.diagnostics.database_errors.length,0);assert.equal(proof.diagnostics.adapter_failures.length,0);proof.passed=true;proof.commands=proof.results.length;
})().catch(error=>{proof.passed=false;proof.failure={name:error.name,message:error.message};proof.diagnostics=runtime?.diagnostics();process.exitCode=1;}).finally(async()=>{proof.completed_at=new Date().toISOString();if(db)await db.$disconnect();fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:proof.passed,commands:proof.commands,failure:proof.failure,out}));});
