/** Ordered resolved guards from production; existing-position handling and exposure I/O stay in caller. */
export function evaluateMaterializationPrice(avgPrice:number){
 return Number.isFinite(avgPrice)&&avgPrice>0?{allowed:true as const}:{allowed:false as const,reason:'invalid_average_price' as const};
}
export function evaluateMaterializationExposureQuantity(exposurePresent:boolean,executedQty:number){
 if(!exposurePresent)return {allowed:false as const,reason:'missing_live_exposure' as const};
 const quantity=Math.abs(executedQty);
 if(!Number.isFinite(quantity)||quantity<=0)return {allowed:false as const,reason:'invalid_executed_quantity' as const};
 return {allowed:true as const,quantity};
}
