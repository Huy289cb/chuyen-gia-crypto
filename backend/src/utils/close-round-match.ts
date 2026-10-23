import type { ExchangeRound } from './exchange-rounds';
/** Exact existing production round identity/quantity selection, including legacy coercion. */
export function selectCloseExchangeRound(rounds: ExchangeRound[], sideInput: string, entryOrderId: string | null | undefined, sizeQty: number, allowVerifiedPartialReduction = false): ExchangeRound | null {
  const side = ['long', 'buy'].includes(sideInput.toLowerCase()) ? 'long' : 'short';
  const matches = rounds.filter(r => r.side === side && r.fills.some(f => String(f.orderId) === String(entryOrderId) &&
    f.side.toUpperCase() === (side === 'long' ? 'BUY' : 'SELL')));
  if (matches.length !== 1) return null;
  const round = matches[0]!;
  const same=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-6);
  if (!same(round.quantity,Math.abs(sizeQty))) {
    if(!allowVerifiedPartialReduction||!Number.isFinite(sizeQty)||sizeQty===0)return null;
    const opening=side==='long'?'BUY':'SELL',fills=round.fills.slice().sort((a,b)=>a.time-b.time);
    if(!fills.length||fills.at(-1)!.time!==round.closeTime||fills[0].time!==round.entryTime)return null;
    const ids=fills.map(f=>f.tradeId==null?'':String(f.tradeId));
    if(ids.some(id=>!id)||new Set(ids).size!==ids.length||fills.some(f=>!Number.isFinite(f.time)||!Number.isFinite(f.qty)||f.qty<=0||!['BUY','SELL'].includes(f.side.toUpperCase())))return null;
    const entries=fills.filter(f=>f.side.toUpperCase()===opening),exits=fills.filter(f=>f.side.toUpperCase()!==opening);
    if(!entries.length||!exits.length||entries.some(f=>String(f.orderId)!==String(entryOrderId))||Math.max(...entries.map(f=>f.time))>=Math.min(...exits.map(f=>f.time)))return null;
    if(!same(entries.reduce((n,f)=>n+f.qty,0),round.quantity)||!same(exits.reduce((n,f)=>n+f.qty,0),round.quantity))return null;
    const last=String(exits.at(-1)!.orderId),lastFills=exits.filter(f=>String(f.orderId)===last),earlier=exits.filter(f=>String(f.orderId)!==last);
    if(!earlier.length||Math.max(...earlier.map(f=>f.time))>=Math.min(...lastFills.map(f=>f.time))||!same(lastFills.reduce((n,f)=>n+f.qty,0),Math.abs(sizeQty)))return null;
  }
  return round;
}
