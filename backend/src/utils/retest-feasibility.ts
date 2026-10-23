import type { observeEntryFeasibility } from './entry-feasibility-observation';
type Measurement = ReturnType<typeof observeEntryFeasibility>;
export function compareRetestFeasibility(first: Measurement | undefined, retest: Measurement) {
  if (first && (first.version !== retest.version || first.minSlFraction !== retest.minSlFraction ||
    first.minRr !== retest.minRr || first.structureTimeframe !== retest.structureTimeframe))
    return { paired: false, reason: 'policy_mismatch' };
  if (!first?.geometry || !retest.geometry || first.asOf >= retest.asOf ||
    !('entry' in first) || !('entry' in retest)) return { paired: false, reason: 'missing_or_noncausal_pair' };
  const before = first.geometry, after = retest.geometry;
  const beforeRoom = before.availableTargetFraction, afterRoom = after.availableTargetFraction;
  return { paired: true, role: 'diagnostic_not_pnl', elapsedMs: retest.asOf-first.asOf,
    first, retest, entryChangeFraction: (retest.entry!-first.entry!)/first.entry!,
    targetChanged: first.targetBound !== retest.targetBound,
    stopChanged: first.stopLoss !== retest.stopLoss,
    targetRoomDelta: beforeRoom !== null && afterRoom !== null ? afterRoom-beforeRoom : null,
    becameGeometryFeasible: !before.feasible && after.feasible,
    becameGeometryInfeasible: before.feasible && !after.feasible };
}
