import {it,expect} from 'vitest';
import {validPartialFillEvidence,sealedEntryStatus,entryHasMaterializableFill} from '../../src/utils/partial-fill-evidence';
const initial={orderId:123,symbol:'BTCUSDT',remoteOrderId:123,remoteSymbol:'BTCUSDT',executedQty:.001,minimumObservedQty:0,requirePositive:true};
it('requires identity and positive observed qty before cancelling remainder',()=>{
 expect(validPartialFillEvidence(initial)).toBe(true);
 for(const patch of [{executedQty:0},{executedQty:NaN},{remoteOrderId:124},{remoteSymbol:'ETHUSDT'},{orderId:0}])expect(validPartialFillEvidence({...initial,...patch})).toBe(false);
});
it('uses authoritative re-query qty without erasing fills that raced cancellation',()=>{
 const final={...initial,minimumObservedQty:.001,requirePositive:false};
 expect(validPartialFillEvidence({...final,executedQty:.002})).toBe(true);
 expect(validPartialFillEvidence({...final,executedQty:0})).toBe(false);
 expect(sealedEntryStatus('PARTIALLY_FILLED')).toBe(false);
 expect(entryHasMaterializableFill('CANCELED',.001)).toBe(true);
 expect(entryHasMaterializableFill('CANCELED',0)).toBe(false);
});

it('replays actual paired queries without treating materialization eligibility as a protected position',async()=>{
 const {replayRecordedPartialRequery}=await import('../../src/utils/partial-fill-evidence');
 const row={schema:'partial-fill-requery-v1',exchange_order_id:'123',symbol:'BTCUSDT',initial_known_at:10,final_known_at:20,
 initial:{orderId:123,symbol:'BTCUSDT',status:'PARTIALLY_FILLED',executedQty:.001},final:{orderId:123,symbol:'BTCUSDT',status:'CANCELED',executedQty:.002}};
 expect(replayRecordedPartialRequery(row,20)).toMatchObject({next_action:'materialization_checks',observed_quantity:.002});
 expect(replayRecordedPartialRequery({...row,final:{...row.final,status:'PARTIALLY_FILLED'}},20)).toMatchObject({next_action:'keep_pending'});
 expect(replayRecordedPartialRequery(row,19).status).toBe('unknown');
 expect(replayRecordedPartialRequery({...row,final:{...row.final,executedQty:0}},20)).toMatchObject({next_action:'invalid_final'});
});
