import type { CoreCandidate } from './core-ablation';
/**
 * Research lane: candidates passing the core's other filters but failing its M5 guard.
 * Select by pre-execution gate membership only, never by realized trade outcomes.
 */
export function selectStructureLedM5(current: readonly CoreCandidate[], relaxed: readonly CoreCandidate[]): CoreCandidate[] {
  const baseline = new Map(current.map(c => [c.id, c]));
  const expanded = new Map(relaxed.map(c => [c.id, c]));
  if (baseline.size !== current.length || expanded.size !== relaxed.length) throw Error('duplicate_candidate');
  for (const [id, candidate] of baseline) {
    const common = expanded.get(id);
    if (!common || JSON.stringify(common) !== JSON.stringify(candidate)) throw Error('non_monotonic_gate_or_changed_geometry');
  }
  const selected = relaxed.filter(c => !baseline.has(c.id));
  if (selected.some(c => c.timeframe !== '5m')) throw Error('unexpected_non_m5_candidate');
  return [...selected].sort((a,b) => a.time-b.time || a.id.localeCompare(b.id));
}
