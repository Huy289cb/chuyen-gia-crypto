import type {Prisma} from '@prisma/client';
import {buildAccountResetReceipt} from '../utils/account-reset-receipt';
/** Caller must use the same transaction as reset. Never persist after commit as a substitute. */
export async function insertAccountResetReceipt(tx:Prisma.TransactionClient,receipt:ReturnType<typeof buildAccountResetReceipt>){
 await tx.$executeRaw`INSERT INTO account_mutation_journal (attempt_id,account_id,mutation_kind,evidence)
 VALUES (${receipt.reset_attempt_id}::uuid,${receipt.account_id},${receipt.mutation_kind},${JSON.stringify(receipt)}::jsonb)`;
}
