const assert=require('node:assert/strict'),{audit}=require('./audit-execution-journal.cjs');
const base={schema:'execution-parity-export-v1',since:'2026-09-08T00:00:00Z',through:'2026-09-26T00:00:00Z',events:[],orders:[],positions:[]};
let checks=0;
assert.equal(audit(base).parityStatus,'unknown');assert.equal(audit(base).roiStatus,'unproved');checks++;
assert.equal(audit(base).typeCoverage.position_closed,'unknown_legacy_export');checks++;
assert.equal(audit({...base,exportedEventTypes:['entry_order_filled']}).typeCoverage.position_closed,'omitted');checks++;
const p={position_id:'p',binance_order_id:'123',entry_time:'2026-09-10T00:00:00Z',status:'open',realized_pnl:0,entry_fee:0,exit_fee:0,funding_fee:0};
const open=audit({...base,positions:[p]}).rows[0];assert.equal(open.closed,false);assert.equal(open.dbSnapshotRealizedPnl,null);checks++;
assert(open.issues.includes('fee_funding_ledger_unverified'));checks++;
const duplicate=audit({...base,positions:[p,{...p,position_id:'p2'}]});assert.equal(duplicate.parityStatus,'mismatch');assert.equal(duplicate.duplicateEntryIdentities[0].positions.length,2);checks++;
const closed={...p,status:'closed',close_time:'2026-09-11T00:00:00Z',realized_pnl:1};
const r=audit({...base,positions:[closed],events:[{position_id:'p',event_type:'position_closed',event_data:{bookkeeping_close:true,fill_verified:false}}]}).rows[0];assert(r.issues.includes('bookkeeping_close_is_not_trade_outcome'));assert.equal(r.replayCompleteness,'unknown');checks++;
assert(audit({...base,positions:[{...p,entry_time:'2026-09-07T00:00:00Z'}]}).rows[0].issues.includes('entry_before_window_requires_initial_state'));checks++;
const ack=audit({...base,positions:[p],events:[{position_id:'p',event_type:'protective_order_acknowledged',event_data:{
 acknowledgement_schema:'client-receipt-v1',acknowledgement_data_status:'observed',binance_order_id:'999',protection_type:'stop_loss',
 request_started_at:'2026-09-10T01:00:00Z',acknowledgement_received_at:'2026-09-10T01:00:01Z'}}]});
assert.equal(ack.rows[0].protectiveReceiptEvents,1);assert.equal(ack.parityStatus,'unknown');
assert(ack.rows[0].issues.includes('protective_execution_replay_not_run'));checks++;
console.log(JSON.stringify({checks,liveOrdersSent:0,dbQueries:0}));
