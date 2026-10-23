import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetPendingOrder:{findUnique:vi.fn(),updateMany:vi.fn()}}}));
vi.mock('../../src/repositories/testnet.repository',()=>({PIPELINE_EVENT_POSITION_ID:'pipeline',recordPipelineEvent:vi.fn(),recordSilentPipelineEvent:vi.fn()}));
vi.mock('../../src/services/telegram/telegram-hooks',()=>({hookPendingCancelled:vi.fn()}));
vi.mock('../../src/services/binanceClient',()=>({initTestnetClient:vi.fn(),cancelOrder:vi.fn()}));
import {prisma} from '../../src/lib/prisma';
import {cancelOrder,initTestnetClient} from '../../src/services/binanceClient';
import {recordPipelineEvent,recordSilentPipelineEvent} from '../../src/repositories/testnet.repository';
import {cancelPendingOnExchangeAndDb} from '../../src/services/pending-order-actions';
const order={order_id:'local',symbol:'BTC',binance_order_id:'123',status:'pending'};
const ack={orderId:123,symbol:'BTCUSDT',status:'CANCELED',executedQty:'0'};
const prior=process.env.BINANCE_ENABLED;
beforeEach(()=>{vi.resetAllMocks();process.env.BINANCE_ENABLED='true';vi.mocked(initTestnetClient).mockReturnValue({} as never);vi.mocked(prisma.testnetPendingOrder.findUnique).mockResolvedValue({status:'pending'} as never);vi.mocked(prisma.testnetPendingOrder.updateMany).mockResolvedValue({count:1});vi.mocked(cancelOrder).mockResolvedValue(ack);});
afterEach(()=>{if(prior===undefined)delete process.env.BINANCE_ENABLED;else process.env.BINANCE_ENABLED=prior;});
describe('pending cancellation acknowledgement',()=>{
 it('skips an already terminal row without another exchange action',async()=>{
  vi.mocked(prisma.testnetPendingOrder.findUnique).mockResolvedValue({status:'executed'} as never);
  await cancelPendingOnExchangeAndDb(order,'ttl_expired');expect(cancelOrder).not.toHaveBeenCalled();expect(prisma.testnetPendingOrder.updateMany).not.toHaveBeenCalled();
 });
 it('rejects malformed exchange identity before calling the exchange',async()=>{
  await expect(cancelPendingOnExchangeAndDb({...order,binance_order_id:'invalid'},'ttl_expired')).rejects.toThrow('invalid_exchange_identity');expect(cancelOrder).not.toHaveBeenCalled();
 });
 it('writes terminal status only after the exchange acknowledgement',async()=>{
  vi.mocked(cancelOrder).mockImplementation(async()=>{expect(prisma.testnetPendingOrder.updateMany).not.toHaveBeenCalled();return ack;});
  await cancelPendingOnExchangeAndDb(order,'ttl_expired');expect(prisma.testnetPendingOrder.updateMany).toHaveBeenCalledOnce();expect(recordPipelineEvent).toHaveBeenCalledOnce();
 });
 it('journals ACK and preserves cancellation behavior when telemetry persistence fails',async()=>{
  vi.mocked(recordSilentPipelineEvent).mockRejectedValue(new Error('storage unavailable'));
  await cancelPendingOnExchangeAndDb(order,'ttl_expired');
  expect(prisma.testnetPendingOrder.updateMany).toHaveBeenCalledOnce();
  expect(recordSilentPipelineEvent).toHaveBeenCalledWith('pending_cancel_ack',expect.objectContaining({
    schema:'pending-cancel-ack-v1',confirmed_zero_fill:true,ack,pending_status:'pending'}));
 });
 it('preserves local occupancy on network failure',async()=>{vi.mocked(cancelOrder).mockRejectedValue(new Error('network'));await expect(cancelPendingOnExchangeAndDb(order,'ttl_expired')).rejects.toThrow('network');expect(prisma.testnetPendingOrder.updateMany).not.toHaveBeenCalled();expect(recordPipelineEvent).not.toHaveBeenCalled();});
 it.each([{executedQty:'.001'},{executedQty:undefined},{status:'FILLED'},{symbol:'ETHUSDT'},{orderId:999}])('leaves ambiguous/filled acknowledgement for reconciliation: %j',async patch=>{
  vi.mocked(cancelOrder).mockResolvedValue({...ack,...patch});await expect(cancelPendingOnExchangeAndDb(order,'price_drift')).rejects.toThrow('requires_reconciliation');expect(prisma.testnetPendingOrder.updateMany).not.toHaveBeenCalled();
 });
 it('does not overwrite a terminal DB state won by a concurrent fill',async()=>{
  vi.mocked(prisma.testnetPendingOrder.updateMany).mockResolvedValue({count:0});await cancelPendingOnExchangeAndDb(order,'ttl_expired');expect(recordPipelineEvent).not.toHaveBeenCalled();
  expect(prisma.testnetPendingOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{order_id:'local',status:{in:['pending','partially_filled']}}}));
 });
});
