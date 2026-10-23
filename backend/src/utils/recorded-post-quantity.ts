import { replayPostQuantityAdmission, type PostQuantityAdmissionInput } from './post-quantity-admission';
/** JSON preserves a recorded nonfinite RR/invalidation separately from missing input. */
export function encodePostQuantityInput(input:PostQuantityAdmissionInput) {
 return {schema:'post-quantity-input-v1',...input,
  expectedRr:Number.isFinite(input.expectedRr)?input.expectedRr:null,
  expectedRrStatus:Number.isFinite(input.expectedRr)?'finite':'nonfinite',
  expectedRrNonfinite:Number.isFinite(input.expectedRr)?null:String(input.expectedRr),
  invalidation:Number.isFinite(input.invalidation)?input.invalidation:null,
  invalidationStatus:Number.isFinite(input.invalidation)?'finite':'nonfinite',
  invalidationNonfinite:Number.isFinite(input.invalidation)?null:String(input.invalidation),
  remainingDailyRiskUsd:input.remainingDailyRiskUsd??null};
}
export function replayRecordedPostQuantity(record:Record<string,unknown>) {
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(record.schema!=='post-quantity-input-v1')return unknown('missing_post_quantity_schema');
 if(!['long','short'].includes(String(record.side))||typeof record.dailyEnabled!=='boolean')return unknown('missing_direction_or_daily_flag');
 for(const key of ['entry','stopLoss','effectiveRiskUsd','effectiveRiskPercent','effectiveRiskCapUsd','minRr'])
  if(typeof record[key]!=='number'||!Number.isFinite(record[key]))return unknown('missing_financial_input:'+key);
 for(const key of ['expectedRr','invalidation']){
  const status=record[key+'Status'];
  if(status==='finite') {if(typeof record[key]!=='number'||!Number.isFinite(record[key]))return unknown('invalid_numeric_encoding:'+key);}
  else if(status!=='nonfinite'||record[key]!==null||!['NaN','Infinity','-Infinity'].includes(String(record[key+'Nonfinite'])))return unknown('missing_numeric_status:'+key);
 }
 if(record.remainingDailyRiskUsd!==null&&(typeof record.remainingDailyRiskUsd!=='number'||!Number.isFinite(record.remainingDailyRiskUsd)))return unknown('invalid_daily_state');
 return replayPostQuantityAdmission({...record,
  expectedRr:record.expectedRrStatus==='nonfinite'?Number(record.expectedRrNonfinite):record.expectedRr,
  invalidation:record.invalidationStatus==='nonfinite'?Number(record.invalidationNonfinite):record.invalidation} as unknown as PostQuantityAdmissionInput);
}
