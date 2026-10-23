import { evaluateProtectiveAction, type ProtectiveAction, type SlTpLevels } from './protective-action';

export interface RecordedProtectiveAction {
  schema: 'protective-action-v1';
  stage: 'planned' | 'recomputed';
  mark_status: 'observed' | 'missing' | 'failed';
  input: { side: 'long' | 'short'; stop_loss: number | null; take_profit: number | null; mark: number | null; levels?: SlTpLevels | null };
  decision: ProtectiveAction;
}

export function replayRecordedProtectiveAction(record: unknown):
  | { status: 'unknown'; reason: string }
  | { status: 'evaluated'; decision: ProtectiveAction; matches_recorded: boolean } {
  if (!record || typeof record !== 'object') return { status: 'unknown', reason: 'missing_record' };
  const value = record as Partial<RecordedProtectiveAction>;
  if (value.schema !== 'protective-action-v1' || !['planned', 'recomputed'].includes(value.stage ?? ''))
    return { status: 'unknown', reason: 'unsupported_schema_or_stage' };
  const input = value.input;
  if (value.mark_status !== 'observed' || !input || !Number.isFinite(input.mark) || Number(input.mark) <= 0)
    return { status: 'unknown', reason: 'missing_observed_mark' };
  if (!['long', 'short'].includes(input.side) || !Number.isFinite(input.stop_loss) || input.stop_loss === null ||
      !Number.isFinite(input.take_profit) || input.take_profit === null ||
      !['place_sl_tp', 'close_at_market_loss', 'close_at_market_profit', 'recompute_and_place'].includes(value.decision ?? ''))
    return { status: 'unknown', reason: 'invalid_input_or_decision' };
  if (value.stage === 'planned' && input.levels !== undefined)
    return { status: 'unknown', reason: 'unexpected_planned_levels' };
  if (value.stage === 'recomputed' && (!input.levels || !Number.isFinite(input.levels.stop_loss) || !Number.isFinite(input.levels.take_profit)))
    return { status: 'unknown', reason: 'missing_recomputed_levels' };
  const decision = evaluateProtectiveAction({ side: input.side, stop_loss: input.stop_loss, take_profit: input.take_profit,
    mark: input.mark as number, ...(input.levels ? { levels: input.levels } : {}) });
  return { status: 'evaluated', decision, matches_recorded: decision === value.decision };
}
