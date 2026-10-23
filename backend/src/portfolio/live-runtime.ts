import path from 'node:path';
import { backendRoot, readJson, writeJsonAtomic } from './paper-store';
import { readLiveWallet } from './live-store';
import { LIVE_CONFIG, LIVE_POLICY_ID, type LivePortfolioWallet } from './live-service';

export function livePortfolioDirectory(): string {
  return path.resolve(process.env.PORTFOLIO_LIVE_DATA_DIR || path.join(backendRoot, 'data/portfolio-live', LIVE_POLICY_ID));
}

export async function recordLiveWorkerStatus(status: Record<string, unknown>): Promise<void> {
  await writeJsonAtomic(path.join(livePortfolioDirectory(), 'worker-status.json'), {
    ...status, mode: 'live', policyId: LIVE_POLICY_ID, updatedAt: new Date().toISOString(),
  });
}

/** Read models only. An HTTP request can never start a broker or submit an order. */
export async function livePortfolioStatus(): Promise<Record<string, unknown>> {
  const directory = livePortfolioDirectory();
  const [stored, worker, readiness] = await Promise.all([
    readLiveWallet<LivePortfolioWallet>(directory),
    readJson<Record<string, unknown>>(path.join(directory, 'worker-status.json')),
    readJson<Record<string, unknown>>(path.join(directory, 'readiness.json')),
  ]);
  let wallet: Record<string, unknown> | null = null;
  if (stored) {
    const { accountIdentity: _identity, handoffSha256: _handoff, processedTradeIds: _trades,
      processedIncomeIds: _incomes, monitoringSupport: _monitoringSupport, ...publicWallet } = stored;
    wallet = { ...publicWallet, trades: stored.trades.slice(-100), incomes: stored.incomes.slice(-100),
      intents: stored.intents.slice(-100), days: stored.days.slice(-128) };
  }
  const capital = stored?.config.initialCash ?? process.env.PORTFOLIO_LIVE_INITIAL_CASH ?? LIVE_CONFIG.initialCash;
  return { mode: 'live', enabled: process.env.PORTFOLIO_LIVE_ENABLED === 'true', policyId: LIVE_POLICY_ID,
    config: { ...LIVE_CONFIG, ...stored?.config, initialCash: capital, initialCapital: capital },
    wallet, worker, readiness, continuousRiskGuarantee: false,
    nextScheduledSourceAt: new Date((Math.floor(Date.now() / 86_400_000) + 1) * 86_400_000).toISOString() };
}
