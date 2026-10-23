import { prisma } from '../lib/prisma';
/** Existing pipeline anchor only: telemetry must never create an account or position. */
export async function persistAccountWalletObservation(evidence: Record<string, unknown>, eventType: 'account_wallet_sync_observed' | 'account_wallet_reconcile_applied' | 'account_net_statistics_applied' | 'account_guard_mutation_applied' | 'account_cooldown_set_applied' | 'account_circuit_mutation_applied' | 'account_precision_reset_applied' | 'account_starting_balance_sync_applied' | 'account_backfill_statistics_applied' | 'account_manual_close_applied' = 'account_wallet_sync_observed'): Promise<void> {
  const anchor = await prisma.testnetPosition.findUnique({where:{position_id:'pipeline_v3_kim_nghia'},select:{position_id:true}});
  if (!anchor) throw new Error('account_wallet_journal_anchor_missing');
  await prisma.testnetTradeEvent.create({data:{position_id:anchor.position_id,event_type:eventType,
    event_data:JSON.stringify(evidence),timestamp:new Date()}});
}
