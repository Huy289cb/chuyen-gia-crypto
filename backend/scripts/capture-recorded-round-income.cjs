// Reuses deployed GET collectors and round accounting; no DB or execution imports.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const[exportFile,ledgerFile,outFile]=process.argv.slice(2);
if(!exportFile||!ledgerFile||!outFile||fs.existsSync(outFile))throw Error('Usage: EXPORT FILL_LEDGER NEW_OUTPUT');
const bytes=fs.readFileSync(exportFile),ledgerBytes=fs.readFileSync(ledgerFile),input=JSON.parse(bytes),ledger=JSON.parse(ledgerBytes);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(ledger.inputSha256!==sha(bytes))throw Error('ledger_export_mismatch');
const apps=JSON.parse(cp.execFileSync('pm2',['jlist'],{encoding:'utf8'})),worker=apps.find(a=>a.name==='crypto-worker');
if(!worker?.pid||worker.pm2_env.status!=='online')throw Error('worker_not_online');
Object.assign(process.env,Object.fromEntries(fs.readFileSync('/proc/'+worker.pid+'/environ','utf8').split('\0').filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})));
const {fetchUserTradesByTimeWindows}=require('../dist/services/binance-trade-history.service');
const {fetchBinanceIncomeRows}=require('../dist/services/binance-income.service');
const {reconstructExchangeRounds}=require('../dist/utils/exchange-rounds');
(async()=>{
 const known=ledger.rows.flatMap(r=>r.fills??[]);if(!known.length)throw Error('no_fill_times');
 const startTime=Math.min(...known.map(f=>f.time))-60000,endTime=Math.max(...known.map(f=>f.time))+60000;
 const [fills,income]=await Promise.all([fetchUserTradesByTimeWindows('BTCUSDT',endTime,endTime-startTime+1),fetchBinanceIncomeRows({symbol:'BTC',startTime,endTime})]);
 const rounds=reconstructExchangeRounds(fills,income);
 const rows=input.positions.map(p=>{
  const matches=rounds.filter(r=>r.fills.some(f=>String(f.orderId)===String(p.binance_order_id)&&f.side===(p.side==='long'?'BUY':'SELL')));
  if(matches.length!==1)return {positionId:p.position_id,status:'unknown',reason:'unique_complete_round_missing'};
  const r=matches[0],recorded=ledger.rows.find(x=>x.positionId===p.position_id);
  const expectedIds=(recorded?.fills??[]).map(f=>String(f.id));
  const actualIds=r.fills.map(f=>String(f.tradeId));
  const identityMatches=expectedIds.length>0&&expectedIds.length===actualIds.length&&expectedIds.every(id=>actualIds.includes(id));
  const delta={quantity:r.quantity-p.size_qty,entryFee:r.entryFee-p.entry_fee,exitFee:r.exitFee-p.exit_fee,
   fundingFee:r.fundingFee-p.funding_fee,netPnl:r.netPnl-p.realized_pnl};
  const matched=identityMatches&&Object.values(delta).every(v=>Number.isFinite(v)&&Math.abs(v)<1e-7);
  return {positionId:p.position_id,status:matched?'matched_round_component':'mismatch',identityMatches,delta,round:r};
 });
 const result={schema:'recorded-round-income-v1',capturedAt:new Date().toISOString(),inputSha256:sha(bytes),ledgerSha256:sha(ledgerBytes),
  exchangeAccess:'GET only, running worker environment',query:{startTime,endTime},fills,income,roundCount:rounds.length,rows,
  fullExecutionParity:'unknown',roiStatus:'unproved',limitations:['Observed exchange rounds and funding only; not a replay of strategy decisions, occupancy or risk.',
   'Historical protection acknowledgement timing and AI cost coverage are still incomplete.','Cohort net is not period account ROI; one entry predates the observation window.']};
 fs.writeFileSync(path.resolve(outFile),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({fills:fills.length,income:income.length,rounds:rounds.length,statuses:rows.map(r=>r.status),netPnl:rows.reduce((s,r)=>s+(r.round?.netPnl??0),0)}));
})().catch(()=>{console.error('round_income_capture_failed');process.exitCode=1;});
