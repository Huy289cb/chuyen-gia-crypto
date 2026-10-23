import { describe, it, expect } from 'vitest';
import { replayRecordedProtectiveAcknowledgement as replay } from '../../src/utils/recorded-protective-ack';
const now = Date.parse('2026-10-02T10:40:00Z');
const request = { algoType: 'CONDITIONAL', symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', quantity: '0.001', triggerPrice: '90', reduceOnly: true };
const response = { algoId: 12, algoType: 'CONDITIONAL', symbol: 'BTCUSDT', side: 'SELL', orderType: 'STOP_MARKET', quantity: '0.0010', triggerPrice: '90.0',
  algoStatus: 'NEW', workingType: 'CONTRACT_PRICE', positionSide: 'BOTH', reduceOnly: true, closePosition: false, priceProtect: false };
const record = { acknowledgement_schema: 'client-receipt-v1', protection_type: 'stop_loss', binance_order_id: '12', symbol: 'BTCUSDT', side: 'SELL',
  request_started_at: new Date(now - 2000).toISOString(), acknowledgement_received_at: new Date(now - 1000).toISOString(),
  algo_contract_evidence: { schema: 'algo-contract-evidence-v1', request, response } };
describe('recorded protective receipt contract', () => {
  it('matches numeric wire quantities without interpreting legacy executed_qty as a fill', () => {
    const result = replay(JSON.parse(JSON.stringify({ ...record, executed_qty: 99 })), now, now);
    expect(result).toEqual({ status: 'receipt_contract_matches', order_id: '12', working_type: 'CONTRACT_PRICE', position_side: 'BOTH', quantity: .001,
      trigger_price: 90, price_protect: false, current_protection: 'not_established' });
  });
  it.each([{ side: 'BUY' }, { symbol: 'ETHUSDT' }, { orderType: 'TAKE_PROFIT_MARKET' }, { triggerPrice: '91' }, { quantity: '0.002' },
    { reduceOnly: false }, { closePosition: true }, { algoId: 13 }, { positionSide: 'LONG' }])('detects contradictory observed response %j', change => {
    expect(replay({ ...record, algo_contract_evidence: { ...record.algo_contract_evidence, response: { ...response, ...change } } }, now, now).status).toBe('mismatch');
  });
  it.each([{ workingType: null }, { quantity: null }, { algoStatus: 'CANCELED' }, { positionSide: null }, { reduceOnly: null }, { quantity: ' ' }, { priceProtect: null }])('does not invent missing evidence %j', change => {
    expect(replay({ ...record, algo_contract_evidence: { ...record.algo_contract_evidence, response: { ...response, ...change } } }, now, now).status).toBe('unknown');
  });
  it('requires knowledge after receipt and rejects future/missing wire evidence', () => {
    expect(replay(record, now, now - 1).status).toBe('unknown');
    expect(replay(record, now - 1500, now).status).toBe('unknown');
    expect(replay({ ...record, algo_contract_evidence: null }, now, now).status).toBe('unknown');
  });
  it('rejects quantity sent with close-all instead of hiding the invalid request', () => {
    const result = replay({ ...record, algo_contract_evidence: { ...record.algo_contract_evidence, request: { ...request, closePosition: true } } }, now, now);
    expect(result).toEqual({ status: 'mismatch', reason: 'invalid_close_all_request' });
  });
  it('matches explicitly confirmed hedge close-all without inferring quantity coverage', () => {
    const { quantity, reduceOnly, ...base } = request;
    const result = replay({ ...record, algo_contract_evidence: { ...record.algo_contract_evidence,
      request: { ...base, positionSide: 'LONG', closePosition: true }, response: { ...response, positionSide: 'LONG', closePosition: true } } }, now, now);
    expect(result.status).toBe('receipt_contract_matches'); if(result.status === 'receipt_contract_matches') expect(result.quantity).toBeNull();
  });
});
