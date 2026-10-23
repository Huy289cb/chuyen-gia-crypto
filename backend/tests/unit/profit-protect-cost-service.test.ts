import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({amend:vi.fn()}));
vi.mock('../../src/services/amend-protective-sl.service',()=>({amendProtectiveStopLoss:mocks.amend}));
vi.mock('../../src/config/risk-policy',()=>({getRiskPolicy:()=>({maxFeePercent:.1,maxSlippagePercent:.1})}));
import {maybeApplyProfitProtectSl,clearProfitProtectState} from '../../src/services/profit-protect.service';
describe('profit protection cash-cost integration',()=>{
 const position={position_id:'cost-test',symbol:'BTC',side:'long',entry_price:100000,stop_loss:99200,size_qty:.001,
  entry_fee:.05,funding_fee:.01,entry_time:new Date(0),binance_sl_order_id:'test'};
 beforeEach(()=>{
  vi.stubEnv('BINANCE_ENABLED','true');vi.stubEnv('PROFIT_PROTECT_ENABLED','true');vi.stubEnv('PROFIT_PROTECT_BE_AT_R','2');
  vi.stubEnv('PROFIT_PROTECT_BE_FEE_BUFFER_PCT','.08');vi.stubEnv('PROFIT_PROTECT_TRAIL_ACTIVATE_PCT','2.5');
  vi.stubEnv('PROFIT_PROTECT_TIME_STOP_HOURS','0');vi.stubEnv('PROFIT_PROTECT_COST_AWARE_BE','false');
  mocks.amend.mockReset().mockResolvedValue({ok:true,reason:'mock'});clearProfitProtectState(position.position_id);
 });
 afterEach(()=>{vi.unstubAllEnvs();clearProfitProtectState(position.position_id);});
 it('keeps live levels unchanged by default while recording negative estimated net at the old BE',async()=>{
  const result=await maybeApplyProfitProtectSl(position,101600);
  expect(result.newSl).toBe(100080);expect(mocks.amend.mock.calls[0][0].meta.estimated_net_at_stop_usd).toBeLessThan(0);
  expect(mocks.amend.mock.calls[0][0].meta.cash_breakeven_enabled).toBe(false);
 });
 it('uses accrued costs only after explicit opt-in and retains2R activation',async()=>{
  vi.stubEnv('PROFIT_PROTECT_COST_AWARE_BE','true');
  expect((await maybeApplyProfitProtectSl(position,101599)).applied).toBe(false);expect(mocks.amend).not.toHaveBeenCalled();
  const result=await maybeApplyProfitProtectSl(position,101600);
  expect(result.newSl).toBeGreaterThan(100210);expect(mocks.amend.mock.calls[0][0].meta.estimated_net_at_stop_usd).toBeGreaterThan(0);
 });
});
