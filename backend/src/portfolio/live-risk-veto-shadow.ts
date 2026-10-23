import type { RiskVetoObservation, RiskVetoShadowDeps } from '../services/openrouter-risk-veto-shadow.service';
import type { SourceDailyRow } from './market-data';
import type { SourcePortfolioTargets } from './types';

/**
 * LOG-ONLY research hook: after the daily target is prepared, ask the
 * OpenRouter risk-veto shadow for verdicts on a detached snapshot.
 *
 * Contract with the live worker:
 * - flag OFF (default): returns immediately, the service module is not loaded;
 * - never throws synchronously and the returned promise never rejects;
 * - the caller must not await it (`void`), and the target object is only read.
 */
export function observeLiveRiskVetoShadow(
  target: SourcePortfolioTargets,
  closedDailyRows: readonly SourceDailyRow[],
  deps?: RiskVetoShadowDeps,
): Promise<RiskVetoObservation | null> {
  if (process.env.OPENROUTER_RISK_VETO_SHADOW !== 'true') return Promise.resolve(null);
  try {
    // Copy everything the deferred work needs before yielding to the event loop.
    const targetCopy: SourcePortfolioTargets = JSON.parse(JSON.stringify(target));
    const rowsCopy = closedDailyRows.slice(-31).map(row => ({ openTimeMs: row.openTimeMs, closes: { ...row.closes } }));
    return import('../services/openrouter-risk-veto-shadow.service')
      .then(service => service.scheduleRiskVetoShadow(
        () => service.buildRiskVetoPlanSnapshot({ target: targetCopy, closedDailyRows: rowsCopy }), deps) ?? null)
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}
