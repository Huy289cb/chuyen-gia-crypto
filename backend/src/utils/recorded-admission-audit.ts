import {computeExecutionRisk,resolveExecutionRiskCapUsd} from './execution-risk';
import {resolveQuantityForMinNotional} from './order-quantity';
type Row=Record<string,unknown>;
/** Audit explicit recorded inputs only. No environment, current account state or inferred historical balance. */
export function auditRecordedAdmission(d:Row):{status:'matched'|'mismatch'|'unknown';fields:string[]}{
 const kind=d.stage;
 if(d.admission_schema!=='financial-inputs-v1'||!['quantity_checked','risk_checked'].includes(String(kind)))return {status:'unknown',fields:['missing_input_schema']};
 const keys=kind==='quantity_checked'?['raw_quantity','entry','min_notional','min_qty','step_size','remaining_exposure_usd','notional_tolerance_percent']:
  ['entry','stop_loss','normalized_quantity','account_balance','admission_fee_percent','admission_slippage_percent','max_risk_percent'];
 const missing=keys.filter(k=>typeof d[k]!=='number'||!Number.isFinite(d[k]));
 if(kind==='risk_checked'&&d.max_risk_usd!==null&&(typeof d.max_risk_usd!=='number'||!Number.isFinite(d.max_risk_usd)))missing.push('max_risk_usd');
 if(missing.length)return {status:'unknown',fields:missing};
 const n=(k:string)=>d[k] as number;
 const mismatches:string[]=[],unknown:string[]=[];
 const compare=(key:string,value:number)=>{if(typeof d[key]!=='number'||!Number.isFinite(d[key]))unknown.push(key);else if(Math.abs(n(key)-value)>1e-8*Math.max(1,Math.abs(value)))mismatches.push(key);};
 try{
  if(kind==='quantity_checked'){
   const q=resolveQuantityForMinNotional({quantity:n('raw_quantity'),entryPrice:n('entry'),minNotionalUsd:n('min_notional'),minQty:n('min_qty'),stepSize:n('step_size'),maxNotionalUsd:n('remaining_exposure_usd'),tolerancePercent:n('notional_tolerance_percent')});
   compare('normalized_quantity',q.normalizedQty);compare('order_notional',q.orderNotional);
   if(!Object.hasOwn(d,'rejection_code'))unknown.push('rejection_code');else if(d.rejection_code!==(q.code??null))mismatches.push('rejection_code');
  }else{
   const risk=computeExecutionRisk({entry:n('entry'),stopLoss:n('stop_loss'),quantity:n('normalized_quantity'),balance:n('account_balance'),roundTripFeePercent:n('admission_fee_percent'),slippagePercent:n('admission_slippage_percent')});
   for(const [key,value] of Object.entries(risk))compare(key,value);
   compare('cap_usd',resolveExecutionRiskCapUsd({balance:n('account_balance'),maxRiskPercent:n('max_risk_percent'),maxRiskUsd:d.max_risk_usd as number|null}));
  }
 }catch{return {status:'unknown',fields:['invalid_recorded_inputs']};}
 return mismatches.length?{status:'mismatch',fields:mismatches}:unknown.length?{status:'unknown',fields:unknown}:{status:'matched',fields:[]};
}
