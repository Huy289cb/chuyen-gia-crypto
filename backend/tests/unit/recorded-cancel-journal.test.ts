import {it,expect} from 'vitest';
import {replayCancelJournal} from '../../src/utils/recorded-cancel-journal';
const at=Date.parse('2026-10-02T00:00:00Z');
const ack={id:1,timestamp:new Date(at).toISOString(),event_type:'pending_cancel_ack',event_data:{schema:'pending-cancel-ack-v1',cancel_attempt_id:'a',order_id:'local',symbol:'BTC',exchange_order_id:'123',pending_status:'pending',ack:{orderId:123,symbol:'BTCUSDT',status:'CANCELED',executedQty:'0'}}};
const claim={id:2,timestamp:new Date(at+1000).toISOString(),event_type:'pending_cancel_db_claim',event_data:{schema:'pending-cancel-claim-v1',cancel_attempt_id:'a',order_id:'local',claimed_count:1,target_status:'cancelled_ttl_expired'}};
it('pairs recorded exchange/DB events and excludes future claims from a historical decision',()=>{
 expect(replayCancelJournal([claim,ack],at+1000).rows[0].transition).toMatchObject({status:'evaluated',occupancy_released:true});
 const prefix=replayCancelJournal([claim,ack],at);expect(prefix.excludedFuture).toBe(1);expect(prefix.rows[0].transition.status).toBe('unknown');
});
it('leaves missing, duplicate attempt ACKs and legacy terminal events unknown',()=>{
 const r=replayCancelJournal([ack,{...ack,id:3},claim,{...claim,id:4,event_type:'pending_order_cancelled',event_data:{}}],at+1000);
 expect(r.rows[0].transition.status).toBe('unknown');expect(r.unknown).toEqual([{event_id:'4',reason:'missing_cancel_attempt_id'}]);
});
