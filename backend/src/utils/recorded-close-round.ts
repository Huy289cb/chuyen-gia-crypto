import { reconstructExchangeRounds, type ExchangeFill, type FundingIncome } from './exchange-rounds';
import { selectCloseExchangeRound } from './close-round-match';
const validId=(v:unknown)=>typeof v==='string'&&v.length>0||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** Measured exchange-round replay; provider costs and account ledger remain separate. */
export function replayRecordedCloseRound(record:unknown,knownAt:number,asOf:number){
 const unknown=(reason:string)=>({status:'unknown' as const,reason});
 if(!Number.isFinite(knownAt)||!Number.isFinite(asOf))return unknown('missing_knowledge_time');
 if(knownAt>asOf)return unknown('not_known_at_cutoff');
 const data=object(record),input=object(data?.input),observations=object(data?.observations);
 if(data?.schema!=='close-round-query-v1'||!input||!observations)return unknown('missing_query_schema');
 const received=typeof observations.received_at==='string'?Date.parse(observations.received_at):NaN;
 if(!Number.isFinite(received)||received>knownAt||observations.source!=='binance_window_queries'||observations.fills_complete!==true||observations.income_complete!==true)
  return unknown('missing_complete_query_provenance');
 if(input.symbol!=='BTCUSDT'||!['long','short','buy','sell'].includes(String(input.side))||typeof input.entry_order_id!=='string'||!input.entry_order_id||
  !Number.isFinite(input.size_qty)||Number(input.size_qty)===0||!Number.isFinite(input.window_start)||!Number.isFinite(input.window_end)||
  Number(input.window_start)>Number(input.window_end)||Number(input.window_end)>received)return unknown('invalid_query_input_or_bounds');
 if(!Array.isArray(observations.fills)||!Array.isArray(observations.income))return unknown('missing_raw_rows');
 const fillIds=new Set<string>(),incomeIds=new Set<string>();
 for(const raw of observations.fills){const f=object(raw);
  if(!f||!validId(f.tradeId)||!validId(f.orderId)||f.commissionAsset!=='USDT'||![f.price,f.qty,f.commission,f.realizedPnl,f.time].every(Number.isFinite)||
   Number(f.time)<Number(input.window_start)||Number(f.time)>Number(input.window_end)||!['BUY','SELL'].includes(String(f.side)))return unknown('invalid_or_unpriced_fill');
  const id=String(f.tradeId);if(!id||fillIds.has(id))return unknown('duplicate_fill_identity');fillIds.add(id);
 }
 for(const raw of observations.income){const row=object(raw);
  if(!row||row.asset!=='USDT'||typeof row.incomeType!=='string'||typeof row.income!=='string'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(row.income)||!Number.isFinite(Number(row.income))||!Number.isFinite(row.time)||!validId(row.tranId)||
   Number(row.time)<Number(input.window_start)||Number(row.time)>Number(input.window_end))return unknown('invalid_or_unpriced_income');
  const id=row.incomeType+':'+String(row.tranId);if(incomeIds.has(id))return unknown('duplicate_income_identity');incomeIds.add(id);
 }
 try{
  const rounds=reconstructExchangeRounds(observations.fills as ExchangeFill[],observations.income as FundingIncome[]);
  const round=selectCloseExchangeRound(rounds,input.side as string,input.entry_order_id as string,input.size_qty as number,input.partial_reduction === true);
  if(!round)return unknown('missing_or_ambiguous_complete_round');
  if(![round.netPnl,round.entryFee,round.exitFee,round.fundingFee,round.grossPnl].every(Number.isFinite))return unknown('nonfinite_round_cost');
  return {status:'evaluated' as const,round,exchange_net_pnl:round.netPnl,economic_total_pnl:null,
   ledger_completeness:'not_established' as const,limits:'Measured shared exchange-round reconstruction only; initial inventory, provider cost, external transfers and complete portfolio ROI remain unverified.'};
 }catch{return unknown('round_reconstruction_failed');}
}
