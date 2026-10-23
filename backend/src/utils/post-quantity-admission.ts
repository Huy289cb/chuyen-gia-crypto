/** Production post-quantity gates, in their original order. I/O belongs to adapters. */
export interface PostQuantityAdmissionInput {
  side:'long'|'short'; entry:number; stopLoss:number;
  effectiveRiskUsd:number; effectiveRiskPercent:number; effectiveRiskCapUsd:number;
  expectedRr:number; minRr:number; invalidation:number;
  dailyEnabled:boolean; remainingDailyRiskUsd:number|null|undefined;
}
export function evaluatePostQuantityAdmission(input:PostQuantityAdmissionInput):
 {allowed:true}|{allowed:false;rejectionCode?:'risk_cap'|'rr'|'daily_risk';reason:string} {
 const {side,entry,stopLoss,effectiveRiskUsd,effectiveRiskPercent,effectiveRiskCapUsd,
 expectedRr,minRr,invalidation,dailyEnabled,remainingDailyRiskUsd}=input;
 if(effectiveRiskUsd>effectiveRiskCapUsd+1e-9)return {allowed:false,rejectionCode:'risk_cap',
  reason:`Exchange minimum would risk ${effectiveRiskPercent.toFixed(2)}% of wallet after fees/slippage `+
  `(cap ${effectiveRiskCapUsd.toFixed(4)} USDT)`};
 if(!Number.isFinite(expectedRr)||expectedRr+1e-9<minRr)return {allowed:false,rejectionCode:'rr',reason:`R:R ${expectedRr.toFixed(2)} below minimum ${minRr}`};
 if(Number.isFinite(invalidation)&&invalidation>0&&((side==='long'&&(invalidation>=entry||stopLoss>invalidation))||
 (side==='short'&&(invalidation<=entry||stopLoss<invalidation))))return {allowed:false,reason:'Stop must protect the structural invalidation level'};
 // Preserve legacy production semantics; callers must not claim parity when daily state is absent.
 if(dailyEnabled&&remainingDailyRiskUsd!=null&&effectiveRiskUsd>remainingDailyRiskUsd+1e-9)
 return {allowed:false,rejectionCode:'daily_risk',reason:'Projected stop loss after costs exceeds remaining daily loss budget'};
 return {allowed:true};
}
/** Strict recorded adapter: unknown state is not an admission or parity success. */
export function replayPostQuantityAdmission(input:PostQuantityAdmissionInput) {
 if(input.dailyEnabled&&(input.remainingDailyRiskUsd==null||!Number.isFinite(input.remainingDailyRiskUsd)))
  return {status:'unknown' as const,reason:'missing_daily_risk_state'};
 if([input.entry,input.stopLoss,input.effectiveRiskUsd,input.effectiveRiskPercent,input.effectiveRiskCapUsd,input.minRr].some(v=>!Number.isFinite(v)))
  return {status:'unknown' as const,reason:'missing_financial_inputs'};
 return {status:'evaluated' as const,decision:evaluatePostQuantityAdmission(input)};
}
