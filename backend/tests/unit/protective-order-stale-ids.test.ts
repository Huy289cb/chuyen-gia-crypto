import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/services/binance/account',()=>({getPositionRisk:vi.fn().mockResolvedValue([{symbol:'BTCUSDT',positionAmt:0.01}])}));
import {getPositionRisk} from '../../src/services/binance/account';
import { fetchBinanceNetPosition } from '../../src/services/binance-exposure.service';
import { replayRecordedProtectiveAction } from '../../src/utils/recorded-protective-action';

vi.mock('../../src/repositories/testnet.repository', () => ({
  updateTestnetPosition: vi.fn(),
  recordTestnetTradeEvent: vi.fn(),
}));

vi.mock('../../src/services/binanceClient', () => ({
  getOpenAlgoOrders: vi.fn(),
  placeStopLossOrder: vi.fn(),
  placeTakeProfitOrder: vi.fn(),
}));

vi.mock('../../src/services/binance-hedge-mode', () => ({
  ensurePositionModeDetected: vi.fn(),
  getPositionMode: vi.fn().mockReturnValue('ONE_WAY'),
}));

vi.mock('../../src/services/binance-exposure.service', () => ({
  fetchBinanceNetPosition: vi.fn().mockResolvedValue({
    markPrice: 63200,
    side: 'long',
    positionAmt: 0.01,
  }),
}));

vi.mock('../../src/services/position-close.service', () => ({
  closePositionOnBinanceMarket: vi.fn(),
  closeLocalPosition: vi.fn(),
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetPosition: {
      findUnique: vi.fn(),
    },
  },
}));

import { updateTestnetPosition, recordTestnetTradeEvent } from '../../src/repositories/testnet.repository';
import {
  getOpenAlgoOrders,
  placeStopLossOrder,
  placeTakeProfitOrder,
} from '../../src/services/binanceClient';
import { closePositionOnBinanceMarket } from '../../src/services/position-close.service';
import {
  extractOpenAlgoOrderIds,
  reconcileStaleProtectiveOrderIds,
  placeProtectiveOrdersForPosition,
} from '../../src/services/protective-order.service';

describe('extractOpenAlgoOrderIds', () => {
  it('collects algoId and orderId from open algo rows', () => {
    const ids = extractOpenAlgoOrderIds([
      { algoId: '9001', orderType: 'STOP_MARKET' },
      { orderId: '9002', orderType: 'TAKE_PROFIT_MARKET' },
    ]);
    expect(ids).toEqual(new Set(['9001', '9002']));
  });
});

describe('reconcileStaleProtectiveOrderIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves the executed SL identity when exchange confirms flat after it leaves open orders',async()=>{
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([]);
    vi.mocked(getPositionRisk).mockResolvedValueOnce([{symbol:'BTCUSDT',positionAmt:0}] as Awaited<ReturnType<typeof getPositionRisk>>);
    const r=await reconcileStaleProtectiveOrderIds({position_id:'closed_race',symbol:'BTC',binance_sl_order_id:'filled_sl',binance_tp_order_id:'tp'});
    expect(r.repairBlocked).toBe('flat');expect(r.binance_sl_order_id).toBe('filled_sl');
    expect(updateTestnetPosition).not.toHaveBeenCalled();
  });
  it.each([[],[{symbol:'BTCUSDT',positionAmt:NaN}],[{symbol:'ETHUSDT',positionAmt:0}]].map(rows=>({rows})))('does not treat incomplete position data as confirmed flat: $rows',async({rows})=>{
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([]);
    vi.mocked(getPositionRisk).mockResolvedValueOnce(rows as Awaited<ReturnType<typeof getPositionRisk>>);
    const r=await reconcileStaleProtectiveOrderIds({position_id:'malformed',symbol:'BTC',binance_sl_order_id:'sl'});
    expect(r.repairBlocked).toBe('unknown');expect(updateTestnetPosition).not.toHaveBeenCalled();
  });
  it('does not erase IDs when open orders or position state is unavailable',async()=>{
    const p={position_id:'unknown',symbol:'BTC',binance_sl_order_id:'sl'};
    vi.mocked(getOpenAlgoOrders).mockRejectedValueOnce(new Error('timeout'));
    expect((await reconcileStaleProtectiveOrderIds(p)).repairBlocked).toBe('unknown');
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([]);
    vi.mocked(getPositionRisk).mockRejectedValueOnce(new Error('unavailable'));
    expect((await reconcileStaleProtectiveOrderIds(p)).repairBlocked).toBe('unknown');
    expect(updateTestnetPosition).not.toHaveBeenCalled();
  });

  it('clears stale SL/TP ids when openAlgoOrders is empty', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([]);

    const result = await reconcileStaleProtectiveOrderIds({
      position_id: 'pos_test',
      symbol: 'BTC',
      binance_sl_order_id: 'old_sl',
      binance_tp_order_id: 'old_tp',
    });

    expect(result.clearedSl).toBe(true);
    expect(result.clearedTp).toBe(true);
    expect(result.binance_sl_order_id).toBeNull();
    expect(result.binance_tp_order_id).toBeNull();
    expect(updateTestnetPosition).toHaveBeenCalledWith('pos_test', {
      binance_sl_order_id: null,
      binance_tp_order_id: null,
    });
  });

  it('keeps ids that still exist on Binance', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { algoId: 'live_sl', orderType: 'STOP_MARKET' },
      { algoId: 'live_tp', orderType: 'TAKE_PROFIT_MARKET' },
    ]);

    const result = await reconcileStaleProtectiveOrderIds({
      position_id: 'pos_test',
      symbol: 'BTC',
      binance_sl_order_id: 'live_sl',
      binance_tp_order_id: 'live_tp',
    });

    expect(result.clearedSl).toBe(false);
    expect(result.clearedTp).toBe(false);
    expect(updateTestnetPosition).not.toHaveBeenCalled();
  });

  it('clears only the stale id when one still exists', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { algoId: 'live_sl', orderType: 'STOP_MARKET' },
    ]);

    const result = await reconcileStaleProtectiveOrderIds({
      position_id: 'pos_test',
      symbol: 'BTC',
      binance_sl_order_id: 'live_sl',
      binance_tp_order_id: 'gone_tp',
    });

    expect(result.clearedSl).toBe(false);
    expect(result.clearedTp).toBe(true);
    expect(updateTestnetPosition).toHaveBeenCalledWith('pos_test', {
      binance_tp_order_id: null,
    });
  });
});

describe('placeProtectiveOrdersForPosition stale ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([]);
    vi.mocked(placeStopLossOrder).mockResolvedValue({ orderId: 'new_sl' });
    vi.mocked(placeTakeProfitOrder).mockResolvedValue({ orderId: 'new_tp' });
    vi.mocked(recordTestnetTradeEvent).mockReset();
  });

  it('persists measured planned and recomputed decisions through JSON with replay parity', async () => {
    const outcome = await placeProtectiveOrdersForPosition({ position_id: 'action_record', symbol: 'BTC', side: 'long',
      entry_price: 63000, size_qty: 0.01, stop_loss: 62500, take_profit: 64000 });
    expect(outcome).toBe('ok');
    const actions = vi.mocked(recordTestnetTradeEvent).mock.calls.filter(call => call[1] === 'protective_action_evaluated');
    expect(actions.map(call => (call[2] as any).stage)).toEqual(['planned', 'recomputed']);
    for (const call of actions) {
      const data = JSON.parse(JSON.stringify(call[2]));
      expect(data.mark_status).toBe('observed');
      expect(data.input.mark).toBe(63200);
      expect(replayRecordedProtectiveAction(data)).toEqual({status: 'evaluated', decision: 'place_sl_tp', matches_recorded: true});
    }
  });

  it.each(['missing', 'failed'])('records unavailable mark as %s without inventing replay evidence', async status => {
    if (status === 'missing') vi.mocked(fetchBinanceNetPosition).mockResolvedValueOnce(null);
    else vi.mocked(fetchBinanceNetPosition).mockRejectedValueOnce(new Error('mark unavailable'));
    const outcome = await placeProtectiveOrdersForPosition({ position_id: 'action_' + status, symbol: 'BTC', side: 'long',
      entry_price: 63000, size_qty: 0.01, stop_loss: 62500, take_profit: 64000 });
    expect(outcome).toBe('ok');
    const actions = vi.mocked(recordTestnetTradeEvent).mock.calls.filter(call => call[1] === 'protective_action_evaluated');
    expect(actions).toHaveLength(2);
    for (const call of actions) {
      expect((call[2] as any).mark_status).toBe(status);
      expect(replayRecordedProtectiveAction(JSON.parse(JSON.stringify(call[2])))).toEqual({ status: 'unknown', reason: 'missing_observed_mark' });
    }
    expect(placeStopLossOrder).toHaveBeenCalledOnce();
    expect(placeTakeProfitOrder).toHaveBeenCalledOnce();
  });

  it('records local SL/TP acknowledgement receipt with actual IDs and no invented trigger mode', async () => {
    const evidence = { schema: 'algo-contract-evidence-v1', request: { quantity: '0.01' }, response: { quantity: '0.01', workingType: 'CONTRACT_PRICE' } };
    vi.mocked(placeStopLossOrder).mockResolvedValueOnce({ orderId: 'new_sl', algo_contract_evidence: evidence });
    const outcome = await placeProtectiveOrdersForPosition({ position_id: 'ack_receipt', symbol: 'BTC', side: 'long',
      entry_price: 63000, size_qty: 0.01, stop_loss: 62500, take_profit: 64000 });
    expect(outcome).toBe('ok');
    const ack = vi.mocked(recordTestnetTradeEvent).mock.calls.filter(call => call[1] === 'protective_order_acknowledged');
    expect(ack).toHaveLength(2);
    expect(ack[0]).toEqual(['ack_receipt', 'protective_order_acknowledged', expect.objectContaining({
      acknowledgement_schema: 'client-receipt-v1', protection_type: 'stop_loss', binance_order_id: 'new_sl',
      executed_qty: 0.01, symbol: 'BTCUSDT', side: 'SELL', working_type: null, acknowledgement_data_status: 'observed' })]);
    expect(ack[1][2]).toEqual(expect.objectContaining({ protection_type: 'take_profit', binance_order_id: 'new_tp' }));
    const data = ack[0][2] as any;
    expect(JSON.parse(JSON.stringify(data.algo_contract_evidence))).toEqual(evidence);
    expect(Date.parse(data.acknowledgement_received_at)).toBeGreaterThanOrEqual(Date.parse(data.request_started_at));
  });

  it('journal failure does not retry or close successfully protected exposure', async () => {
    vi.mocked(recordTestnetTradeEvent).mockRejectedValueOnce(new Error('journal unavailable'));
    const outcome = await placeProtectiveOrdersForPosition({ position_id: 'ack_failure', symbol: 'BTC', side: 'long',
      entry_price: 63000, size_qty: 0.01, stop_loss: 62500, take_profit: 64000 });
    expect(outcome).toBe('ok');
    expect(placeStopLossOrder).toHaveBeenCalledOnce();
    expect(placeTakeProfitOrder).toHaveBeenCalledOnce();
    expect(closePositionOnBinanceMarket).not.toHaveBeenCalled();
  });

  it('pending journal writes do not delay SL/TP placement completion', async () => {
    vi.mocked(recordTestnetTradeEvent).mockImplementation(() => new Promise(() => {}));
    const outcome = await placeProtectiveOrdersForPosition({ position_id: 'ack_pending', symbol: 'BTC', side: 'long',
      entry_price: 63000, size_qty: 0.01, stop_loss: 62500, take_profit: 64000 });
    expect(outcome).toBe('ok');
    expect(placeTakeProfitOrder).toHaveBeenCalledOnce();
  });

  it('does not submit replacement protection after the original SL closes exposure',async()=>{
    vi.mocked(getPositionRisk).mockResolvedValueOnce([{symbol:'BTCUSDT',positionAmt:0}] as Awaited<ReturnType<typeof getPositionRisk>>);
    const result=await placeProtectiveOrdersForPosition({position_id:'race',symbol:'BTC',side:'long',entry_price:63000,
      size_qty:.01,stop_loss:62500,take_profit:64000,binance_sl_order_id:'finished_sl',binance_tp_order_id:'tp'});
    expect(result).toBe('skipped');expect(updateTestnetPosition).not.toHaveBeenCalled();
    expect(placeStopLossOrder).not.toHaveBeenCalled();expect(placeTakeProfitOrder).not.toHaveBeenCalled();
    expect(closePositionOnBinanceMarket).not.toHaveBeenCalled();
  });

  it('re-places SL/TP when DB has stale ids and openAlgoOrders is empty', async () => {
    const outcome = await placeProtectiveOrdersForPosition({
      position_id: 'pos_1780935622791_pn99g9',
      symbol: 'BTC',
      side: 'long',
      entry_price: 63000,
      size_qty: 0.01,
      stop_loss: 62500,
      take_profit: 64000,
      binance_sl_order_id: 'stale_sl',
      binance_tp_order_id: 'stale_tp',
    });

    expect(outcome).toBe('ok');
    expect(updateTestnetPosition).toHaveBeenCalledWith(
      'pos_1780935622791_pn99g9',
      expect.objectContaining({ binance_sl_order_id: null, binance_tp_order_id: null })
    );
    expect(placeStopLossOrder).toHaveBeenCalled();
    expect(placeTakeProfitOrder).toHaveBeenCalled();
  });

  it('skips when both ids are live on Binance', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([
      { algoId: 'live_sl' },
      { algoId: 'live_tp' },
    ]);

    const outcome = await placeProtectiveOrdersForPosition({
      position_id: 'pos_ok',
      symbol: 'BTC',
      side: 'long',
      entry_price: 63000,
      size_qty: 0.01,
      stop_loss: 62500,
      take_profit: 64000,
      binance_sl_order_id: 'live_sl',
      binance_tp_order_id: 'live_tp',
    });

    expect(outcome).toBe('skipped');
    expect(placeStopLossOrder).not.toHaveBeenCalled();
    expect(placeTakeProfitOrder).not.toHaveBeenCalled();
  });

  it('places missing TP when SL already exists and returns ok', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([{ algoId: 'live_sl' }]);
    vi.mocked(placeTakeProfitOrder).mockResolvedValue({ orderId: 'new_tp' });

    const outcome = await placeProtectiveOrdersForPosition({
      position_id: 'pos_missing_tp',
      symbol: 'BTC',
      side: 'long',
      entry_price: 63000,
      size_qty: 0.01,
      stop_loss: 62500,
      take_profit: 64000,
      binance_sl_order_id: 'live_sl',
      binance_tp_order_id: null,
    });

    expect(outcome).toBe('ok');
    expect(placeStopLossOrder).not.toHaveBeenCalled();
    expect(placeTakeProfitOrder).toHaveBeenCalled();
    expect(closePositionOnBinanceMarket).not.toHaveBeenCalled();
  });

  it('places missing SL when TP already exists and returns ok', async () => {
    vi.mocked(getOpenAlgoOrders).mockResolvedValue([{ algoId: 'live_tp' }]);
    vi.mocked(placeStopLossOrder).mockResolvedValue({ orderId: 'new_sl' });

    const outcome = await placeProtectiveOrdersForPosition({
      position_id: 'pos_missing_sl',
      symbol: 'BTC',
      side: 'long',
      entry_price: 63000,
      size_qty: 0.01,
      stop_loss: 62500,
      take_profit: 64000,
      binance_sl_order_id: null,
      binance_tp_order_id: 'live_tp',
    });

    expect(outcome).toBe('ok');
    expect(placeStopLossOrder).toHaveBeenCalled();
    expect(placeTakeProfitOrder).not.toHaveBeenCalled();
    expect(closePositionOnBinanceMarket).not.toHaveBeenCalled();
  });
});
