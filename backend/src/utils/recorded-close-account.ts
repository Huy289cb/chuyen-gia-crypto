import { buildCloseAccountUpdate, shouldUpdateClosedAccount } from './close-account-update';
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const clock = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN;
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  const left = object(a), right = object(b); if (!left || !right) return false;
  const keys = Object.keys(left).sort(); return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right,key) && equal(left[key],right[key]));
};
export function replayRecordedCloseAccount(record: unknown, knownAt: number, asOf: number) {
  const unknown = (reason: string) => ({status:'unknown' as const,reason});
  if (!Number.isFinite(knownAt) || !Number.isFinite(asOf)) return unknown('missing_knowledge_time');
  if (knownAt > asOf) return unknown('not_known_at_cutoff');
  const data = object(record), input = object(data?.input), update = object(data?.update);
  if (data?.schema !== 'close-account-update-v1' || !input || !update) return unknown('missing_recorded_schema');
  if (data.applied_clock_source !== undefined && data.applied_clock_source !== 'db_update_return') return unknown('invalid_applied_clock_source');
  if (!Number.isSafeInteger(data.account_id) || Number(data.account_id) <= 0 || !Number.isFinite(input.balance) || !Number.isFinite(input.realized_pnl) ||
      typeof input.bookkeeping !== 'boolean' || typeof input.fill_verified !== 'boolean' || typeof input.binance_enabled !== 'boolean') return unknown('invalid_recorded_input');
  const last = clock(input.last_trade_time), updated = clock(input.updated_at), applied = clock(data.applied_at);
  if (![last,updated,applied].every(Number.isFinite) || last > updated || updated > applied || applied > knownAt) return unknown('invalid_write_clocks');
  if (!shouldUpdateClosedAccount(input.bookkeeping, input.fill_verified, input.binance_enabled)) return {status:'mismatch' as const,reason:'ineligible_account_write'};
  if (input.wallet_authoritative !== undefined && typeof input.wallet_authoritative !== 'boolean') return unknown('invalid_balance_authority');
  if (input.wallet_authoritative === true && input.binance_enabled !== true) return unknown('wallet_authority_without_exchange');
  const expected = buildCloseAccountUpdate({walletAuthoritative:input.wallet_authoritative === true,balance:input.balance as number,realizedPnl:input.realized_pnl as number,lastTradeTime:new Date(last),updatedAt:new Date(updated)});
  if (expected.current_balance !== undefined && !Number.isFinite(expected.current_balance)) return unknown('nonfinite_account_result');
  const serialized = {...expected,last_trade_time:expected.last_trade_time.toISOString(),updated_at:expected.updated_at.toISOString()};
  return {status:'evaluated' as const,account_id:data.account_id as number,matches_recorded:equal(serialized,update),expected_update:serialized,
    application_ordering: data.applied_clock_source === 'db_update_return' ? 'db_return_observed' as const : 'not_established' as const,
    ledger_completeness:'not_established' as const};
}
