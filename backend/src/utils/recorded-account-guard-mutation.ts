import { evaluateAccountInitialGuard } from './account-initial-guard';
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const clock = (v: unknown) => typeof v === 'string' ? Date.parse(v) : NaN;
export function replayRecordedAccountGuardMutation(record: unknown, knownAt: number, asOf: number) {
  const unknown = (reason: string) => ({ status: 'unknown' as const, reason });
  const d = object(record), input = object(d?.input), update = object(d?.update);
  if (![knownAt, asOf].every(Number.isFinite) || knownAt > asOf) return unknown('invalid_knowledge_cutoff');
  if (d?.schema !== 'account-guard-mutation-v1' || !integer(d.account_id) || Number(d.account_id) === 0 ||
    typeof d.mutation_attempt_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.mutation_attempt_id) ||
    !input || !update) return unknown('missing_mutation_input');
  const start = clock(d.write_started_at), applied = clock(d.applied_at);
  if (![start, applied].every(Number.isFinite) || start > applied || applied > knownAt ||
    d.applied_clock_source !== 'db_update_return') return unknown('invalid_write_clocks');
  let expected: Record<string, unknown>;
  if (d.kind === 'expired_cooldown_clear') {
    const now = clock(input.now), until = clock(input.cooldown_until), block = object(input.protective_block);
    if (![now, until].every(Number.isFinite) || now > start ||
      !(input.protective_block === null || (block && typeof block.reason === 'string')) ||
      !(input.consecutive_losses === null || integer(input.consecutive_losses)) || !integer(input.max_consecutive_losses))
      return unknown('invalid_cooldown_input');
    const decision = evaluateAccountInitialGuard({ protectiveBlock: block as {reason:string}|null,
      cooldownUntil:new Date(until),now:new Date(now),consecutiveLosses:input.consecutive_losses as number|null,
      maxConsecutiveLosses:Number(input.max_consecutive_losses) });
    if (!decision.clearExpiredCooldown) return unknown('cooldown_clear_not_supported');
    expected = { cooldown_until: null };
  } else if (d.kind === 'exchange_loss_streak_overwrite') {
    if (input.symbol !== 'BTC' || !integer(input.previous_consecutive_losses) || !integer(input.consecutive_losses) ||
      !integer(input.last_loss_time) || Number(input.last_loss_time) > start ||
      input.previous_consecutive_losses === input.consecutive_losses) return unknown('invalid_loss_streak_input');
    expected = { consecutive_losses: input.consecutive_losses };
  } else return unknown('unsupported_mutation_kind');
  return { status:'evaluated' as const,account_id:d.account_id,expected_update:expected,
    matches_recorded:Object.keys(update).length===Object.keys(expected).length&&Object.entries(expected).every(([k,v])=>update[k]===v),
    exchange_history_completeness:'not_established' as const,economic_total_pnl:null };
}
