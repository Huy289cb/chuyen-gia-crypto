/** Best-effort measurement must not delay or change the exposure decision. */
export function publishExposureObservation(data:Record<string,unknown>,publish:(data:Record<string,unknown>)=>Promise<unknown>):void{
 try{void publish(data).catch(()=>console.warn('[ExposureObservation] persistence unavailable'));}catch{console.warn('[ExposureObservation] persistence unavailable');}
}
