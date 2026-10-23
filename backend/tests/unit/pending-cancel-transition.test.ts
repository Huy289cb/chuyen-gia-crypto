import {it,expect} from 'vitest';
import {confirmsZeroFillCancellation,isPendingOrderTerminal} from '../../src/utils/pending-cancel-transition';
const input={symbol:'BTC',exchangeOrderId:'123',ack:{orderId:123,symbol:'BTCUSDT',status:'CANCELED',executedQty:'0'}};
it('retains occupancy for partial fill, failed/ambiguous cancel, and mismatched acknowledgments',()=>{
 expect(confirmsZeroFillCancellation(input)).toBe(true);
 for(const ack of [null,{...input.ack,executedQty:'.001'},{...input.ack,status:'FILLED'},
 {...input.ack,orderId:124},{...input.ack,symbol:'ETHUSDT'},{...input.ack,executedQty:undefined},
 {...input.ack,executedQty:'unknown'}])expect(confirmsZeroFillCancellation({...input,ack})).toBe(false);
});
it('does not call partial pending or unknown status terminal',()=>{
 for(const status of ['pending','partially_filled','unknown',null])expect(isPendingOrderTerminal(status)).toBe(false);
 for(const status of ['executed','executed_historical','cancelled_ttl_expired','expired','failed'])expect(isPendingOrderTerminal(status)).toBe(true);
});

it('replays captured ACK without treating exchange confirmation as a successful DB claim',async()=>{
 const {replayRecordedCancelAck}=await import('../../src/utils/pending-cancel-transition');
 const row={schema:'pending-cancel-ack-v1',symbol:'BTC',exchange_order_id:'123',pending_status:'pending',ack:input.ack};
 expect(replayRecordedCancelAck(JSON.parse(JSON.stringify(row)))).toMatchObject({status:'evaluated',confirmed_zero_fill:true,occupancy_release:'requires_separate_db_claim'});
 expect(replayRecordedCancelAck({...row,ack:{...input.ack,executedQty:'.001'}})).toMatchObject({confirmed_zero_fill:false});
 expect(replayRecordedCancelAck({})).toMatchObject({status:'unknown'});
});

it('pairs ACK and DBclaim by attempt identity, preserving concurrent fill outcome',async()=>{
 const {replayRecordedCancelClaim}=await import('../../src/utils/pending-cancel-transition');
 const ack={schema:'pending-cancel-ack-v1',symbol:'BTC',exchange_order_id:'123',pending_status:'pending',ack:input.ack,cancel_attempt_id:'attempt',order_id:'local'};
 const claim={schema:'pending-cancel-claim-v1',cancel_attempt_id:'attempt',order_id:'local',claimed_count:1,target_status:'cancelled_ttl_expired'};
 expect(replayRecordedCancelClaim(ack,claim)).toMatchObject({occupancy_released:true});
 expect(replayRecordedCancelClaim(ack,{...claim,claimed_count:0})).toMatchObject({occupancy_released:false,resulting_status:null});
 expect(replayRecordedCancelClaim(ack,{...claim,cancel_attempt_id:'other'}).status).toBe('unknown');
});
