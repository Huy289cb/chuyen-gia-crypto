import {computeTargetRiskSizing} from './target-risk-sizing';
import {checkMinSlDistance} from './trade-levels';
import {resolveTargetPositionNotionalUsd,minNotionalWithTolerance} from '../config/v3-entry-policy';
import {resolveQuantityForMinNotional} from './order-quantity';
import {computeExecutionRisk,resolveExecutionRiskCapUsd} from './execution-risk';
export function replayRecordedQuantityCheck(d:Record<string,any>){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!d||typeof d!=='object'||Array.isArray(d)||d.admission_schema!=='financial-inputs-v1'||!['long','short'].includes(d.side)||!['entry','raw_quantity','min_notional','step_size','min_qty','remaining_exposure_usd','notional_tolerance_percent','normalized_quantity','order_notional'].every(k=>typeof d[k]==='number'&&Number.isFinite(d[k])))return unknown('missing_quantity_input');
 const expected=resolveQuantityForMinNotional({quantity:d.raw_quantity,entryPrice:d.entry,minNotionalUsd:d.min_notional,stepSize:d.step_size,minQty:d.min_qty,maxNotionalUsd:d.remaining_exposure_usd,tolerancePercent:d.notional_tolerance_percent});
 const matches_recorded=expected.normalizedQty===d.normalized_quantity&&expected.orderNotional===d.order_notional&&(expected.code??null)===d.rejection_code;
 return {status:'evaluated' as const,expected,matches_recorded,exchange_filter_availability:'not_established' as const};
}
export function replayRecordedExecutionRisk(d:Record<string,any>){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!d||typeof d!=='object'||Array.isArray(d)||d.admission_schema!=='financial-inputs-v1'||!['long','short'].includes(d.side)||!['entry','stop_loss','account_balance','normalized_quantity','admission_fee_percent','admission_slippage_percent','max_risk_percent','cap_usd'].every(k=>typeof d[k]==='number'&&Number.isFinite(d[k]))||!(d.max_risk_usd===null||typeof d.max_risk_usd==='number'&&Number.isFinite(d.max_risk_usd)))return unknown('missing_risk_input');
 try{const expected=computeExecutionRisk({entry:d.entry,stopLoss:d.stop_loss,quantity:d.normalized_quantity,balance:d.account_balance,roundTripFeePercent:d.admission_fee_percent,slippagePercent:d.admission_slippage_percent}),cap=resolveExecutionRiskCapUsd({balance:d.account_balance,maxRiskPercent:d.max_risk_percent,maxRiskUsd:d.max_risk_usd});
 return {status:'evaluated' as const,expected,cap_usd:cap,matches_recorded:Object.entries(expected).every(([k,v])=>d[k]===v)&&d.cap_usd===cap,actual_exchange_cost_coverage:'not_established' as const,economic_roi:null};
 }catch{return unknown('invalid_risk_input');}
}

/** Reconstruct sizing only for reached quantity-stage inputs; earlier feasibility vetoes remain unobserved. */
export function replayRecordedTargetSizing(d:Record<string,any>){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!d||d.admission_schema!=='financial-inputs-v1'||!['entry','stop_loss','account_balance','target_risk_percent','target_risk_usd','computed_size_usd','selected_notional_usd','min_notional','remaining_exposure_usd','notional_tolerance_percent','effective_min_notional','raw_quantity'].every(k=>typeof d[k]==='number'&&Number.isFinite(d[k]))||d.entry<=0||d.account_balance<=0)return unknown('missing_sizing_input');
 const distance=checkMinSlDistance(d.entry,d.stop_loss,0).distancePct;if(distance<=0)return unknown('zero_stop_distance');
 const target=computeTargetRiskSizing(d.account_balance,d.target_risk_percent,distance),selected=resolveTargetPositionNotionalUsd({computedUsd:target.computedSizeUsd,minNotionalUsd:d.min_notional,remainingCapacityUsd:d.remaining_exposure_usd}),floor=minNotionalWithTolerance(d.min_notional,d.notional_tolerance_percent);
 return {status:'evaluated' as const,expected:{...target,selectedNotionalUsd:selected,effectiveMinNotional:floor,rawQuantity:selected/d.entry},matches_recorded:target.targetRiskUsd===d.target_risk_usd&&target.computedSizeUsd===d.computed_size_usd&&selected===d.selected_notional_usd&&floor===d.effective_min_notional&&selected/d.entry===d.raw_quantity,prior_price_and_stop_floor_veto_coverage:'not_established' as const,economic_roi:null};
}
