const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const clock = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN;
/** Exact local setter overwrite; this does not prove why a caller selected its expiry. */
export function replayRecordedAccountCooldownSet(record: unknown, knownAt: number, asOf: number) {
  const unknown = (reason: string) => ({ status: 'unknown' as const, reason });
  if (![knownAt, asOf].every(Number.isFinite) || knownAt > asOf) return unknown('invalid_knowledge_cutoff');
  const d = object(record), input = object(d?.input), update = object(d?.update);
  if (d?.schema !== 'account-cooldown-set-v1' || !Number.isSafeInteger(d.account_id) || Number(d.account_id) <= 0 ||
    typeof d.cooldown_attempt_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.cooldown_attempt_id) ||
    !input || !update || !Number.isFinite(clock(input.cooldown_until))) return unknown('invalid_setter_input');
  const start = clock(d.write_started_at), applied = clock(d.applied_at);
  if (![start, applied].every(Number.isFinite) || start > applied || applied > knownAt ||
    d.applied_clock_source !== 'db_update_return') return unknown('invalid_write_clocks');
  const expected = { cooldown_until: input.cooldown_until };
  return { status: 'evaluated' as const, account_id: d.account_id, expected_update: expected,
    matches_recorded: Object.keys(update).length === 1 && update.cooldown_until === expected.cooldown_until,
    caller_policy_verification: 'not_established' as const, economic_total_pnl: null };
}
