import {describe,it,expect} from 'vitest';
import {auditRecordedAdmission} from '../../src/utils/recorded-admission-audit';
const risk={stage:'risk_checked',admission_schema:'financial-inputs-v1',entry:80000,stop_loss:79360,normalized_quantity:.001,account_balance:32.2,
 admission_fee_percent:.1,admission_slippage_percent:.1,max_risk_percent:3,max_risk_usd:null,
 priceRiskUsd:.64,feeReserveUsd:.08,slippageReserveUsd:.08,totalRiskUsd:.8,riskPercent:.8/32.2*100,cap_usd:.966};
describe('recorded admission audit',()=>{
 it('matches independently recorded risk arithmetic and detects altered geometry',()=>{
  expect(auditRecordedAdmission(risk).status).toBe('matched');
  expect(auditRecordedAdmission({...risk,stop_loss:79000}).status).toBe('mismatch');
 });
 it('never infers balance or costs from outputs and does not mark missing results matched',()=>{
  expect(auditRecordedAdmission({...risk,account_balance:undefined}).status).toBe('unknown');
  expect(auditRecordedAdmission({...risk,admission_fee_percent:undefined}).status).toBe('unknown');
  expect(auditRecordedAdmission({...risk,cap_usd:undefined}).status).toBe('unknown');
  expect(auditRecordedAdmission({...risk,admission_schema:undefined}).status).toBe('unknown');
 });
 it('uses recorded tolerance at the min-notional boundary',()=>{
  const q={stage:'quantity_checked',admission_schema:'financial-inputs-v1',entry:49500,raw_quantity:50/49500,min_notional:50,min_qty:.001,step_size:.001,remaining_exposure_usd:70,notional_tolerance_percent:5,normalized_quantity:.001,order_notional:49.5,rejection_code:null};
  expect(auditRecordedAdmission(q).status).toBe('matched');
  expect(auditRecordedAdmission({...q,notional_tolerance_percent:0}).status).toBe('mismatch');
 });
});
