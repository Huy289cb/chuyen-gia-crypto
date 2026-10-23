/** Exact production target arithmetic. Caller supplies validated balance and SL-distance fraction. */
export function computeTargetRiskSizing(balance:number,targetRiskPercent:number,slDistancePct:number){
 const targetRiskUsd=balance*(targetRiskPercent/100);
 const computedSizeUsd=targetRiskUsd/slDistancePct;
 return {targetRiskUsd,computedSizeUsd};
}
