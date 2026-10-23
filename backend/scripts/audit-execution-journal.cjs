// Coverage audit, not a replay engine or an estimate of strategy profitability.
function audit(input) {
 if(input.schema!=='execution-parity-export-v1')throw Error('Unsupported schema');
 const events=input.events??[],positions=input.positions??[],orders=input.orders??[];
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const duplicateIds=[];const byBinance=new Map();
 for(const p of positions){if(!p.binance_order_id)continue;const list=byBinance.get(p.binance_order_id)??[];list.push(p.position_id);byBinance.set(p.binance_order_id,list);}
 for(const[id,list]of byBinance)if(list.length>1)duplicateIds.push({binanceOrderId:id,positions:list});
 const requiredTypes=['entry_order_filled','partial_fill','position_closed','protective_failed','protective_order_incomplete','algo_order_filled','protective_order_acknowledged'];
 const selection=input.exportedEventTypes;
 const typeCoverage=Object.fromEntries(requiredTypes.map(type=>[type,selection?(selection.includes(type)?'included':'omitted'):'unknown_legacy_export']));
 const rows=positions.map(p=>{
  const linked=events.filter(e=>e.position_id===p.position_id);
  const entries=linked.filter(e=>e.event_type==='entry_order_filled');
  const closes=linked.filter(e=>e.event_type==='position_closed');
  const acknowledgements=linked.filter(e=>e.event_type==='protective_order_acknowledged');
  const entry=entries.at(-1)?.event_data,close=closes.at(-1)?.event_data;
  const closed=p.status==='closed'&&p.close_time!=null;
  const issues=[];
  if(!entry)issues.push(Date.parse(p.entry_time)<Date.parse(input.since)?'entry_before_window_requires_initial_state':'entry_event_missing');
  if(closed&&!close)issues.push('close_event_missing');
  if(!p.binance_order_id)issues.push('entry_exchange_identity_missing');
  if(entry&&(!finite(entry.executed_qty)||entry.executed_qty<=0))issues.push('recorded_fill_quantity_missing');
  if(entry&&(!entry.code_hash||!entry.policy_hash))issues.push('fill_version_missing');
  if(close&&close.fill_verified!==true&&!close.bookkeeping_close)issues.push('close_fill_verification_missing');
  if(close?.bookkeeping_close)issues.push('bookkeeping_close_is_not_trade_outcome');
  if(!orders.some(o=>o.binance_order_id&&o.binance_order_id===p.binance_order_id))issues.push('order_admission_context_missing');
  // Protective IDs and DB default-zero costs have no timing/trade-ledger proof.
  const validReceipts=acknowledgements.filter(e=>{
   const d=e.event_data??{};
   return d.acknowledgement_schema==='client-receipt-v1'&&d.acknowledgement_data_status==='observed'&&
    d.binance_order_id!=null&&String(d.binance_order_id).length>0&&
    ['stop_loss','take_profit'].includes(d.protection_type)&&
    Number.isFinite(Date.parse(d.request_started_at))&&Number.isFinite(Date.parse(d.acknowledgement_received_at))&&
    Date.parse(d.acknowledgement_received_at)>=Date.parse(d.request_started_at);
  });
  issues.push(validReceipts.length?'protective_execution_replay_not_run':'protective_acknowledgement_timeline_unrecorded','fee_funding_ledger_unverified');
  return{positionId:p.position_id,closed,entryEvents:entries.length,closeEvents:closes.length,
   verifiedCloseFill:close?.fill_verified===true,protectiveReceiptEvents:validReceipts.length,dbSnapshotRealizedPnl:closed&&finite(p.realized_pnl)?p.realized_pnl:null,
   replayCompleteness:'unknown',issues};
 });
 return{schema:'execution-journal-coverage-v1',interval:{since:input.since,through:input.through},
  counts:{events:events.length,orders:orders.length,positions:positions.length,closedPositions:rows.filter(r=>r.closed).length},
  typeCoverage,duplicateEntryIdentities:duplicateIds,rows,
  parityStatus:duplicateIds.length?'mismatch':'unknown',roiStatus:'unproved',
  limitations:['No execution was replayed; this audit identifies missing evidence only.',
   'Snapshot balances, protective IDs and cost defaults cannot reconstruct historical acknowledgement/account state.',
   'Missing events can reflect the observation window or export selection; they do not prove exchange actions never occurred.']};
}
module.exports={audit};
if(require.main===module){const fs=require('node:fs'),crypto=require('node:crypto');const[input,out]=process.argv.slice(2);if(!input||!out)throw Error('Usage: INPUT NEW_OUTPUT');const bytes=fs.readFileSync(input);const result={...audit(JSON.parse(bytes)),inputSha256:crypto.createHash('sha256').update(bytes).digest('hex')};fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({counts:result.counts,parityStatus:result.parityStatus,roiStatus:result.roiStatus}));}
