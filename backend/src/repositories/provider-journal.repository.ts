import {prisma} from '../lib/prisma';
import {buildProviderJournalRecord} from '../utils/provider-journal-record';
/** Independent of accounts/positions. Duplicates and DB failures propagate; no silent upsert. */
export async function insertProviderJournalEvent(eventType:string,data:Record<string,unknown>) {
  const record=buildProviderJournalRecord(eventType,data);
  const affected=await prisma.$executeRaw`INSERT INTO public.provider_request_journal (request_id,event_type,metadata)
    VALUES (${record.request_id},${record.event_type},${JSON.stringify(record.metadata)}::jsonb)`;
  if (affected!==1) throw new Error('provider_journal_insert_not_confirmed');
}
