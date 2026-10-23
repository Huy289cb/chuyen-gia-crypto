/** Resolved cooldown gate; policy resolution and exchange/local reads belong to adapters. */
export interface LossStreakCooldownInput {
 consecutiveLosses:number;lastLossTime:number;minStreak:number;
 untilMs:number|null;checkedAtMs:number|null;remainingAtMs:number|null;
}
export function evaluateLossStreakCooldown(i:LossStreakCooldownInput){
 if(i.consecutiveLosses>=i.minStreak&&i.lastLossTime>0&&i.untilMs!==null&&i.checkedAtMs!==null&&i.checkedAtMs<i.untilMs){
  const remainingH=(i.untilMs-Number(i.remainingAtMs))/3_600_000;
  return {allowed:false,reason:`Binance loss streak ${i.consecutiveLosses} — cooldown ${remainingH.toFixed(1)}h remaining (until ${new Date(i.untilMs).toISOString()})`};
 }
 return {allowed:true,reason:null};
}
export function replayLossStreakCooldown(i:LossStreakCooldownInput){
 if(!i||!Number.isSafeInteger(i.consecutiveLosses)||i.consecutiveLosses<0||!Number.isSafeInteger(i.minStreak)||i.minStreak<0||!Number.isFinite(i.lastLossTime)||i.lastLossTime<0||![i.untilMs,i.checkedAtMs,i.remainingAtMs].every(n=>n===null||typeof n==='number'&&Number.isFinite(n)))return {status:'unknown' as const,reason:'invalid_resolved_streak_inputs'};
 if(i.untilMs!==null&&i.checkedAtMs===null)return {status:'unknown' as const,reason:'missing_comparison_clock'};
 if(i.untilMs!==null&&i.checkedAtMs!==null&&i.checkedAtMs<i.untilMs&&(i.remainingAtMs===null||i.remainingAtMs<i.checkedAtMs))return {status:'unknown' as const,reason:'missing_remaining_clock'};
 return {status:'evaluated' as const,decision:evaluateLossStreakCooldown(i),history_coverage:'not_established' as const};
}
