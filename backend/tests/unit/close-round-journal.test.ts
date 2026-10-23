import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('../../src/services/binance-trade-history.service',()=>({fetchUserTradesByTimeWindows:vi.fn()}));
vi.mock('../../src/services/binance-income.service',()=>({fetchBinanceIncomeRows:vi.fn()}));
import {fetchUserTradesByTimeWindows} from '../../src/services/binance-trade-history.service';
import {fetchBinanceIncomeRows} from '../../src/services/binance-income.service';
import {resolveClosePnlFromUserTrades} from '../../src/services/binance-fill-pnl.service';
import {replayRecordedCloseRound} from '../../src/utils/recorded-close-round';
import {reconstructExchangeRounds} from '../../src/utils/exchange-rounds';
const now=Date.now(),fills=[{tradeId:1,orderId:'entry',side:'BUY',price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:now-2000},
 {tradeId:2,orderId:'exit',side:'SELL',price:110,qty:1,commission:.2,commissionAsset:'USDT',realizedPnl:10,time:now-1000}];
const params={symbol:'BTC',side:'long',entryTime:new Date(now-2000),entryOrderId:'entry',sizeQty:1,entryPrice:100,fallbackClosePrice:110};
describe('raw close-round query observer',()=>{
 beforeEach(()=>{vi.clearAllMocks();process.env.BINANCE_ENABLED='true';vi.mocked(fetchUserTradesByTimeWindows).mockResolvedValue(fills);vi.mocked(fetchBinanceIncomeRows).mockResolvedValue([]);});
 it('records measured queries once and replays resolved net pnl',async()=>{
  const onEvidence=vi.fn();const result=await resolveClosePnlFromUserTrades({...params,onEvidence});expect(result.verified).toBe(true);
  expect(fetchUserTradesByTimeWindows).toHaveBeenCalledOnce();expect(fetchBinanceIncomeRows).toHaveBeenCalledOnce();expect(onEvidence).toHaveBeenCalledOnce();
  const evidence=JSON.parse(JSON.stringify(onEvidence.mock.calls[0][0])),at=Date.now();const replay=replayRecordedCloseRound(evidence,at,at);
  expect(replay.status).toBe('evaluated');if(replay.status==='evaluated')expect(replay.exchange_net_pnl).toBe(result.realizedPnl);
 });
 it('does not fabricate raw queries from supplied rounds',async()=>{
  const onEvidence=vi.fn();const result=await resolveClosePnlFromUserTrades({...params,rounds:reconstructExchangeRounds(fills),onEvidence});expect(result.verified).toBe(true);
  expect(fetchUserTradesByTimeWindows).not.toHaveBeenCalled();expect(fetchBinanceIncomeRows).not.toHaveBeenCalled();
  const evidence=onEvidence.mock.calls[0][0];expect(evidence.observations.source).toBe('supplied_rounds');expect(replayRecordedCloseRound(evidence,Date.now(),Date.now()).status).toBe('unknown');
 });
 it('observer exception cannot change verified resolution',async()=>{
  const result=await resolveClosePnlFromUserTrades({...params,onEvidence:()=>{throw Error('observer failed');}});expect(result.verified).toBe(true);
 });
});
