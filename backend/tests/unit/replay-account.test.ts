import { describe, it, expect } from 'vitest';
import { ReplayAccount, type ReplayAccountOptions } from '../../src/backtest/replay-account';
const base: ReplayAccountOptions = { initialWallet:34.27714639,maxRiskUsd:1,maxRiskPercent:2,targetRiskPercent:.5,maxExposureUsd:100,dailyLossPercent:3,feePerSide:.0005,slippageFraction:.001,funding:[] };
const start=Date.UTC(2026,7,1,0);
const order={key:'range',side:'long' as const,entry:80000,stopLoss:79360,time:start};
describe('replay cash ledger and admission',()=>{
 it('applies production min-notional sizing before rounding a small-wallet order',()=>{
  const a=new ReplayAccount({...base,initialWallet:31.5,maxRiskUsd:null,maxRiskPercent:3,maxExposureUsd:70,
   dailyLossPercent:10,quantityFilters:{minQty:.001,stepSize:.001,minNotionalUsd:50,tolerancePercent:5}});
  // Target sizing is $19.6875. Live raises notional to $50 first, then accepts
  // $49.50 after rounding. Rounding $19.6875 first incorrectly raised size to $99.
  expect(a.tryOpen({...order,entry:49500,stopLoss:49104})).toEqual({accepted:true,quantity:.001});
 });
 it('rejects unknown reserves instead of allowing NaN risk comparisons',()=>{
  expect(()=>new ReplayAccount({...base,admissionReserve:{roundTripFeePercent:NaN,slippagePercent:.1}})).toThrow('Invalid admission reserve');
 });
 it('keeps live admission reserves fixed when realized slippage is stressed',()=>{
  const options={...base,initialWallet:31.5,maxRiskUsd:null,maxRiskPercent:3,
   admissionReserve:{roundTripFeePercent:.1,slippagePercent:.1}};
  const input={...order,entry:90000,stopLoss:89280};
  const normal=new ReplayAccount(options),stress=new ReplayAccount({...options,slippageFraction:.002});
  expect(normal.tryOpen(input)).toEqual({accepted:true,quantity:.001});
  expect(stress.tryOpen(input)).toEqual({accepted:true,quantity:.001});
  expect(normal.wallet-stress.wallet).toBeCloseTo(.045,10);
 });
 it('uses production tolerance instead of raising a valid minimum lot',()=>{
  const options={...base,initialWallet:100,maxRiskUsd:null,maxRiskPercent:3,maxExposureUsd:70,
   quantityFilters:{minQty:.001,stepSize:.001,minNotionalUsd:50,tolerancePercent:5}};
  const input={...order,entry:49500,stopLoss:49104};
  expect(new ReplayAccount(options).tryOpen(input)).toEqual({accepted:true,quantity:.001});
  expect(new ReplayAccount({...options,quantityFilters:{...options.quantityFilters,tolerancePercent:0}}).tryOpen(input))
   .toMatchObject({accepted:false,reason:'execution_risk'});
 });
 it('honors captured lot filters rather than a hardcoded BTC step',()=>{
  const a=new ReplayAccount({...base,maxRiskUsd:null,maxRiskPercent:3,
   quantityFilters:{minQty:.002,stepSize:.002,minNotionalUsd:50,tolerancePercent:0}});
  expect(a.tryOpen(order)).toMatchObject({accepted:false,reason:'execution_risk'});
 });
 it('charges entry costs immediately, funding once and actual exit-leg fees',()=>{
  const a=new ReplayAccount({...base,funding:[{time:start+1000,rate:.001,markPrice:81000}]});
  expect(a.tryOpen(order)).toEqual({accepted:true,quantity:.001});expect(a.wallet).toBeCloseTo(base.initialWallet-.08,10);
  a.advance(start+1000);a.advance(start+2000);expect(a.wallet).toBeCloseTo(base.initialWallet-.161,10);
  const r=a.close('range',80960,start+3000);expect(r.feesUsd).toBeCloseTo(.08048,10);expect(r.fundingUsd).toBeCloseTo(.081,10);expect(r.netUsd).toBeCloseTo(.71852,10);expect(a.wallet-base.initialWallet).toBeCloseTo(r.netUsd,10);
 });
 it('credits shorts and ignores funding outside the holding interval',()=>{
  const a=new ReplayAccount({...base,funding:[{time:start-1000,rate:.1,markPrice:80000},{time:start+1000,rate:.001,markPrice:80000},{time:start+4000,rate:.1,markPrice:80000}]});
  expect(a.tryOpen({...order,side:'short',stopLoss:80640}).accepted).toBe(true);
  const r=a.close('range',79040,start+3000);a.advance(start+5000);expect(r.fundingUsd).toBeCloseTo(-.08,10);expect(a.wallet-base.initialWallet).toBeCloseTo(r.netUsd,10);
 });
 it('blocks overlap and enforces the remaining day budget after a loss',()=>{
  const a=new ReplayAccount(base);expect(a.tryOpen(order).accepted).toBe(true);
  expect(a.tryOpen({...order,key:'micro',time:start+1000})).toMatchObject({accepted:false,reason:'open_position'});
  a.close('range',79360,start+2000);
  expect(a.tryOpen({...order,time:start+3000})).toMatchObject({accepted:false,reason:'daily_budget'});
  expect(a.tryOpen({...order,time:start+86400000})).toMatchObject({accepted:true});
 });
 it('includes costs in the cap and admits a later affordable retest',()=>{
  const a=new ReplayAccount(base);expect(a.tryOpen({...order,stopLoss:79000})).toMatchObject({accepted:false,reason:'execution_risk'});expect(a.tryOpen({...order,time:start+300000})).toMatchObject({accepted:true});
 });
 it('preserves percent fallback',()=>{expect(new ReplayAccount({...base,maxRiskUsd:null}).tryOpen(order)).toMatchObject({accepted:false,reason:'execution_risk'});});
 it.each([{exit:79360,minutes:360},{exit:80960,minutes:90}])('defers either side until post-close expiry for exit $exit',({exit,minutes})=>{
  const a=new ReplayAccount({...base,dailyLossPercent:0,postCloseCooldown:{winMinutes:90,lossMinutes:360}});
  expect(a.tryOpen(order).accepted).toBe(true);const closedAt=start+2000;a.close('range',exit,closedAt);
  const next={...order,side:'short' as const,stopLoss:80640,time:closedAt+minutes*60000-1};
  expect(a.tryOpen(next)).toMatchObject({accepted:false,reason:'post_close_cooldown'});
  expect(a.tryOpen({...next,time:next.time+1})).toMatchObject({accepted:true});
 });
 it('handles fees/funding across midnight',()=>{
  const time=Date.UTC(2026,7,1,16,55);const a=new ReplayAccount({...base,funding:[{time:time+600000,rate:.001,markPrice:80000}]});
  expect(a.tryOpen({...order,time}).accepted).toBe(true);const r=a.close('range',80000,time+900000);expect(r.netUsd).toBeCloseTo(-.24,10);expect(a.wallet-base.initialWallet).toBeCloseTo(-.24,10);
 });
 it('rejects duplicate funding records',()=>{expect(()=>new ReplayAccount({...base,funding:[{time:start,rate:0,markPrice:80000},{time:start,rate:0,markPrice:80000}]})).toThrow('funding');});
});
