export function encodeBackfillRow(p: {position_id:string;close_reason:string|null;realized_pnl:unknown}) {
 const value=p.realized_pnl===null?null:Number(p.realized_pnl);
 return {position_id:p.position_id,close_reason:p.close_reason,
   realized_pnl:Number.isFinite(value)?value:null,
   pnl_status:p.realized_pnl===null?'null':Number.isFinite(value)?'finite':'nonfinite'};
}
