import dotenv from 'dotenv';
import path from 'node:path';
import { observeLiveRiskVetoShadow } from './live-risk-veto-shadow';

// All modules capturing venue credentials are loaded after the environment.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type LiveDailySourceWindow = { nowMs: number; utcMs: number; sourceCursorMs: number };

/** The source cursor is retained until the ordinary daily opportunity has expired. */
export function liveDailySourceWindowOpen(input: LiveDailySourceWindow): boolean {
  const ageMs = input.nowMs - input.utcMs;
  return input.utcMs > input.sourceCursorMs && ageMs >= 0 && ageMs < 60_000;
}

/** Public history is prepared separately from the authenticated monitoring loop. */
export function liveSourcePreparationNeeded(input: LiveDailySourceWindow & {
  technicalRecovery: boolean; preparedUtcMs?: number;
  pending: boolean; lastAttemptUtcMs?: number; lastAttemptAtMs?: number;
}): boolean {
  const dailyWindow = liveDailySourceWindowOpen(input);
  if ((!dailyWindow && !input.technicalRecovery) || input.pending || input.preparedUtcMs === input.utcMs) return false;
  if (input.lastAttemptUtcMs !== input.utcMs) return true;
  // A transient public-history failure can retry within the original first
  // minute, at most every 10s (six starts per uninterrupted daily window).
  // Technical recovery outside that window keeps its existing minute cadence.
  const retryIntervalMs = dailyWindow ? 10_000 : 60_000;
  return input.lastAttemptAtMs === undefined || input.nowMs - input.lastAttemptAtMs >= retryIntervalMs;
}

async function main(): Promise<void> {
  const [{ createDefaultLiveBroker }, { advanceLivePortfolio, LIVE_POLICY_ID },
    { livePortfolioDirectory, recordLiveWorkerStatus }, { readLiveWallet },
    { readJson, writeJsonAtomic }, { loadCctCurrentMarket }, { buildConstantDirectionSourceTargets },
    { LiveTelegramNotifier }, { createLiveTelegramSender }, telegram, { sanitizeLiveTelegramReason }, { LiveQuoteFeed },
    { LiveEquityTelemetry }] = await Promise.all([
    import('./live-broker'), import('./live-service'), import('./live-runtime'), import('./live-store'),
    import('./paper-store'), import('./market-data'), import('./source-constant-direction'),
    import('./live-telegram'), import('./live-telegram-transport'), import('../config/telegram'), import('./live-telegram-format'),
    import('./live-quotes'), import('./live-telemetry'),
  ]);
  type Wallet = import('./live-service').LivePortfolioWallet;
  type Bridge = import('./market-data').CctSourceBridgeCheckpoint;
  const directory = livePortfolioDirectory();
  // Keep every authenticated request bounded. Quotes arrive independently, without
  // making a public REST retry delay real-position monitoring or order handling.
  const venueBroker = createDefaultLiveBroker({ requestTimeoutMs: 3_000, retryReads: false });
  const quoteFeed = new LiveQuoteFeed();
  const broker = new Proxy(venueBroker, { get(target, property, receiver) {
    if (property === 'getMarkPrices') return quoteFeed.getMarkPrices.bind(quoteFeed);
    if (property === 'getTickerPrices') return quoteFeed.getTickerPrices.bind(quoteFeed);
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const sourceFile = path.join(directory, 'source-bridge.json');
  const receiptPath = process.env.PORTFOLIO_LIVE_HANDOFF_FILE || path.join(directory, 'handoff.json');
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const interval = 2_000;
  let sourceJob: Promise<void> | undefined;
  let preparedTarget: import('./source-constant-direction').ConstantDirectionSourcePortfolioTargets | undefined;
  let sourceAttemptUtc: number | undefined;
  let sourceAttemptAtMs: number | undefined;
  let sourceError: string | null = null;
  let lastWallet: Wallet | undefined;
  const telemetry = new LiveEquityTelemetry({ directory });
  const notifier = new LiveTelegramNotifier({ directory, importantOnly: true,
    enabled: telegram.isTelegramEnabled() && telegram.telegramConfig.notifyLevel !== 'off',
    chatIds: telegram.telegramConfig.chatIds, notifyTrades: telegram.shouldNotifyTrades(),
    notifyRisk: telegram.shouldNotifyRisk(), dailyCron: telegram.telegramConfig.dailyReportCron,
    send: createLiveTelegramSender(telegram.telegramConfig.botToken) });
  const notifyError = (reason: string): void => {
    void notifier.recordError(reason, lastWallet).catch(() => {});
  };

  const prepareSource = async (utc: number): Promise<void> => {
    const sourceBridge = await readJson<Bridge>(sourceFile);
    const market = await loadCctCurrentMarket({ sourceBridge: sourceBridge ?? undefined,
      fundingAfterMs: Date.now(), fundingSymbols: [] });
    const raw = buildConstantDirectionSourceTargets(market.closedDailyRows, utc);
    const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    if (Object.entries(raw.decimalWeights).some(([symbol, weight]) => !symbols.includes(symbol) && Number(weight) !== 0)) {
      throw new Error('Source contains an unapproved non-B5 request');
    }
    const basket = <T>(value: Record<string, T>): Record<string, T> => Object.fromEntries(symbols.map(symbol => [symbol, value[symbol]!]));
    const target = { ...raw, weights: basket(raw.weights), raw4Weights: basket(raw.raw4Weights),
      decimalWeights: basket(raw.decimalWeights), executionWeightsScalar6: basket(raw.executionWeightsScalar6),
      baseDesiredWeights: basket(raw.baseDesiredWeights) };
    await writeJsonAtomic(sourceFile, market.sourceBridge);
    // Publish only once the causal history checkpoint is durable. A failed disk
    // write must not leave an apparently ready target for a later recovery.
    preparedTarget = target;
    // LOG-ONLY research lane (OPENROUTER_RISK_VETO_SHADOW, default off): reads a
    // copy of the finished plan, never awaited, never alters targets or orders.
    void observeLiveRiskVetoShadow(target, market.closedDailyRows);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const tickStartedAtMs = Date.now();
    const watchdog = setTimeout(() => {
      console.error(JSON.stringify({ event: 'portfolio_live_watchdog', at: new Date().toISOString(), tickStartedAtMs }));
      notifyError('Live tick exceeded60seconds; worker watchdog restarting; exchange positions may still be open');
      void recordLiveWorkerStatus({ status: 'degraded', pid: process.pid,
        quoteFeed: quoteFeed.health(), intervalMs: interval,
        error: 'Live tick exceeded60seconds; durable intents require reconciliation on restart' })
        .finally(() => process.exit(1));
      setTimeout(() => process.exit(1), 2000);
    }, 60_000);
    try {
      if (process.env.PORTFOLIO_LIVE_ENABLED !== 'true') {
        await recordLiveWorkerStatus({ status: 'disabled', pid: process.pid, quoteFeed: quoteFeed.health(), intervalMs: interval });
      } else {
        if (process.env.PORTFOLIO_EXECUTION_OWNER !== LIVE_POLICY_ID) throw new Error('Live exchange execution owner is not assigned');
        const prior = await readLiveWallet<Wallet>(directory);
        if (prior) lastWallet = prior;
        const now = Date.now(), utc = Math.floor(now / 86_400_000) * 86_400_000;
        let targets: import('./source-constant-direction').ConstantDirectionSourcePortfolioTargets | undefined;
        const technicalRecovery = Boolean(prior?.currentDay.riskLatched
          && prior.currentDay.latchReason === 'live_monitoring_gap');
        if (prior && liveSourcePreparationNeeded({ nowMs: now, utcMs: utc,
          sourceCursorMs: prior.sourceCursorMs, technicalRecovery,
          preparedUtcMs: preparedTarget?.executeAtMs, pending: sourceJob !== undefined,
          lastAttemptUtcMs: sourceAttemptUtc, lastAttemptAtMs: sourceAttemptAtMs })) {
          sourceAttemptUtc = utc; sourceAttemptAtMs = now; sourceError = null;
          // Recovery may request today's already known weights after the normal
          // daily window; service risk/reconciliation checks authorize any order.
          sourceJob = prepareSource(utc).catch(error => {
            sourceError = error instanceof Error ? error.message : 'Source preparation failed';
          }).finally(() => { sourceJob = undefined; });
        }
        const dailySourceWindow = prior !== null && liveDailySourceWindowOpen({ nowMs: now, utcMs: utc,
          sourceCursorMs: prior.sourceCursorMs });
        if (dailySourceWindow && preparedTarget?.executeAtMs === utc) targets = preparedTarget;
        const recoveryTargets = technicalRecovery && preparedTarget?.executeAtMs === utc ? preparedTarget : undefined;
        const wallet = await advanceLivePortfolio({ broker, directory, accountIdentity: broker.identity,
          handoff: { owner: LIVE_POLICY_ID, receiptPath }, targets, recoveryTargets,
          initialCapital: process.env.PORTFOLIO_LIVE_INITIAL_CASH || '100',
          nonBlockingMonitoring: true, autoRecoverTechnical: true,
          // An authenticated observation can cross UTC midnight after this tick
          // evaluated its source. Let the next tick evaluate the new UTC row.
          sourceEvaluationUtcMs: utc,
          // A failed job leaves a retry opportunity. Do not consume the daily
          // cursor merely because no job is running during its retry backoff.
          sourcePending: dailySourceWindow && targets === undefined });
        lastWallet = wallet;
        const backgroundState = wallet.lastObservation.background as { errors?: Record<string, string> } | undefined;
        if (backgroundState?.errors && Object.keys(backgroundState.errors).length) {
          notifyError(Object.values(backgroundState.errors).join('; '));
        }
        // Notification storage/network must never hold up the order/risk loop.
        void notifier.observe(wallet, sourceError ? `Source preparation failed: ${sourceError}` : undefined).catch(() => {});
        // Optional measurement has its own bounded queue and never holds the
        // financial wallet lock, awaits storage, or blocks the 2s risk cadence.
        telemetry.observe(wallet);
        const observationGapMs = prior ? wallet.lastObservedAtMs - prior.lastObservedAtMs : null;
        if (wallet.trades.length !== (prior?.trades.length ?? 0)
          || wallet.sourceCursorMs !== prior?.sourceCursorMs
          || wallet.currentDay.riskLatched !== prior?.currentDay.riskLatched) {
          console.log(JSON.stringify({ event: 'portfolio_live_transition', at: new Date().toISOString(),
            observationGapMs, tickDurationMs: Date.now() - tickStartedAtMs, walletStatus: wallet.status,
            sourceDisposition: wallet.sourceDisposition, sourceCursorMs: wallet.sourceCursorMs,
            actualFillCount: wallet.trades.length, riskLatched: wallet.currentDay.riskLatched,
            latchReason: wallet.currentDay.latchReason }));
        }
        await recordLiveWorkerStatus({ status: wallet.status === 'reconciliation_required' ? 'blocked' : 'running',
          walletStatus: wallet.status, blockedReason: wallet.blockedReason, pid: process.pid,
          lastSuccessfulTick: new Date(wallet.lastObservedAtMs).toISOString(), intervalMs: interval,
          sourceDisposition: wallet.sourceDisposition, sourceCursorMs: wallet.sourceCursorMs,
          sourcePending: sourceJob !== undefined, sourceError,
          dailySourcePending: dailySourceWindow && targets === undefined,
          technicalRecoveryPending: technicalRecovery,
          recoverySourceReady: recoveryTargets !== undefined,
          sourceAttemptAtMs: sourceAttemptAtMs ?? null,
          technicalRecovery: wallet.technicalRecovery ?? null,
          quoteFeed: quoteFeed.health(), nonBlockingMonitoring: true,
          telemetry: telemetry.health(),
          observationAgeMs: Date.now() - wallet.lastObservedAtMs, background: wallet.lastObservation.background ?? null,
          observationGapMs, tickDurationMs: Date.now() - tickStartedAtMs });
      }
    } catch (error) {
      // Last known numbers are labelled stale; do not manufacture a new observation.
      if (lastWallet) telemetry.observe(lastWallet, 'live_worker_tick_failed');
      notifyError(error instanceof Error ? error.message : 'Live worker failed');
      console.error(JSON.stringify({ event: 'portfolio_live_error', at: new Date().toISOString(),
        tickDurationMs: Date.now() - tickStartedAtMs,
        reason: sanitizeLiveTelegramReason(error instanceof Error ? error.message : 'Live worker failed') }));
      await recordLiveWorkerStatus({ status: 'blocked', pid: process.pid,
        quoteFeed: quoteFeed.health(), intervalMs: interval,
        telemetry: telemetry.health(),
        error: error instanceof Error ? error.message : 'Live worker failed' });
    } finally {
      clearTimeout(watchdog);
      if (!stopped) {
        const now = Date.now(), elapsed = now - tickStartedAtMs;
        const day = 86_400_000, offset = (now + 25_200_000) % day, untilBoundary = day - offset;
        // Target a 2s start-to-start cadence, with no overlapping ticks or catch-up
        // burst when a request was slow. Preserve an observation beside ICT midnight.
        const cadenceDelay = Math.max(250, interval - elapsed);
        const delay = untilBoundary <= 1500 ? untilBoundary + 100
          : untilBoundary < cadenceDelay + 2000 ? Math.min(cadenceDelay, untilBoundary - 1200) : cadenceDelay;
        timer = setTimeout(() => { void tick(); }, Math.max(250, delay));
      }
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    stopped = true; if (timer) clearTimeout(timer);
    quoteFeed.stop();
    telemetry.stop();
    // Never pretend stopping a process has closed its exchange positions.
    void Promise.allSettled([recordLiveWorkerStatus({ status: 'stopped', pid: process.pid, quoteFeed: quoteFeed.health(),
      error: 'Worker stopped; exchange positions require monitoring or explicit reconciliation' }),
      notifier.recordError('Worker stopped; exchange positions require monitoring or explicit reconciliation', lastWallet),
    ]).finally(() => { notifier.stop(); process.exit(0); });
  });
  quoteFeed.start();
  await tick();
}

if (require.main === module) void main().catch(() => { process.exitCode = 1; });
