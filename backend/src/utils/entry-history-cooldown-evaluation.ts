/** Exact legacy history decisions; repository filtering/order and clocks remain caller responsibilities. */
export function evaluatePendingCancelCooldown(symbol:string,cooldownMin:number,events:readonly {event_data:string|null;timestamp:Date}[],now:()=>number):string|null{
  const sym = symbol.toUpperCase();
  for (const ev of events) {
    if (!ev.event_data) {
      // BTC-only production: treat unscoped cancel as blocking.
      return `pending re-entry cooldown ${cooldownMin}m after cancel`;
    }
    try {
      const data = JSON.parse(ev.event_data) as { symbol?: string; order_id?: string };
      if (!data.symbol || String(data.symbol).toUpperCase().replace(/USDT$/i, '') === sym) {
        const ago = Math.ceil((now() - ev.timestamp.getTime()) / 60_000);
        return `pending re-entry cooldown ${cooldownMin}m after cancel (${ago}m ago)`;
      }
    } catch {
      return `pending re-entry cooldown ${cooldownMin}m after cancel`;
    }
  }
  return null;
}
export function evaluatePostCloseCooldown(recent:{close_time:Date;side:string},wasLoss:boolean,cooldownMin:number,now:()=>number):string|null{
  const elapsedMin = (now() - recent.close_time.getTime()) / 60_000;
  if (elapsedMin >= cooldownMin) return null;

  const left = Math.ceil(cooldownMin - elapsedMin);
  return (
    `post-close cooldown ${left}m after ${wasLoss ? 'loss' : 'close'} ` +
    `(${cooldownMin}m window, last ${recent.side})`
  );
}
/** Retain only the JSON symbol semantics used by the guard; discard unrelated event fields. */
export function snapshotPendingCancelInputs(events:readonly {event_data:string|null;timestamp:Date}[]){
 return events.map(ev=>{let event_data:string|null=null;
  if(ev.event_data)try{const d=JSON.parse(ev.event_data);event_data=JSON.stringify(d.symbol?{symbol:String(d.symbol)}:{});}catch{event_data='null';}
  return {event_data,timestamp:Number.isFinite(ev.timestamp.getTime())?ev.timestamp.toISOString():'invalid'};
 });
}
