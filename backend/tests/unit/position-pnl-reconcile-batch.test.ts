import { expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({positions:vi.fn(),fills:vi.fn(),income:vi.fn()}));
vi.mock('../../src/lib/prisma',()=>({prisma:{testnetAccount:{findFirst:vi.fn().mockResolvedValue({id:1,symbol:'BTC'})},testnetPosition:{findMany:mocks.positions},testnetTradeEvent:{findFirst:vi.fn().mockResolvedValue(null)}}}));
vi.mock('../../src/services/binance-trade-history.service',()=>({fetchUserTradesByTimeWindows:mocks.fills}));
vi.mock('../../src/services/binance-income.service',()=>({fetchBinanceIncomeRows:mocks.income}));
vi.mock('../../src/services/trade-outcome.service',()=>({resolveDecisionIdForPosition:vi.fn().mockResolvedValue(1)}));
vi.mock('../../src/services/wallet-reconcile.service',()=>({reconcileTestnetWalletFromBinance:vi.fn()}));
vi.mock('../../src/repositories/testnet.repository',()=>({PIPELINE_EVENT_POSITION_ID:'pipeline'}));
import { runClosedPositionPnlReconcile } from '../../src/services/position-pnl-reconcile.service';
it('reconciles multiple positions against one immutable fill/income snapshot',async()=>{
  vi.stubEnv('BINANCE_ENABLED','true');
  const start=Date.parse('2026-08-01T00:00:00Z');
  mocks.positions.mockResolvedValue([0,1,2].map(i=>({position_id:'p'+i,account_id:1,symbol:'BTC',side:'long',
    entry_price:100,entry_time:new Date(start+i*10000),close_time:new Date(start+i*10000+1000),
    close_price:101,current_price:101,realized_pnl:1,size_qty:1,close_reason:'take_profit',
    binance_order_id:String(i*2+1),risk_usd:1})));
  mocks.fills.mockResolvedValue([0,1,2].flatMap(i=>[
    {tradeId:i*2+1,orderId:i*2+1,side:'BUY',price:100,qty:1,commission:0.05,realizedPnl:0,time:start+i*10000},
    {tradeId:i*2+2,orderId:i*2+2,side:'SELL',price:101,qty:1,commission:0.0505,realizedPnl:1,time:start+i*10000+1000}]));
  mocks.income.mockResolvedValue([]);
  const result=await runClosedPositionPnlReconcile({dryRun:true});
  expect(result.verified).toBe(3);expect(result.results.map(r=>r.new_pnl)).toEqual([0.8995,0.8995,0.8995]);
  expect(mocks.fills).toHaveBeenCalledOnce();expect(mocks.income).toHaveBeenCalledOnce();
  vi.unstubAllEnvs();
});
