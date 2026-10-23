import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Decimal } from '@prisma/client/runtime/library';
import { PortfolioPaperEngine } from './paper-engine';
import { buildSourceTargets, SOURCE_UNIVERSE, SOURCE_MOMENTUM_REVISION } from './source-momentum';
import { loadCurrentMarket, loadCctCurrentMarket, loadBoundaryMarks, CCT_RUNTIME_SYMBOLS, type CctSourceBridgeCheckpoint } from './market-data';
import { buildCctSourceTargets } from './source-cct';
import { CCT_PAPER_POLICY, buildCctPaperConfig, normalizePortfolioPaperPolicy, type PortfolioPaperPolicyId } from './policy-registry';
import type { PortfolioPaperConfig, PortfolioPaperEvent, PortfolioPaperState, PortfolioPaperSummary } from './types';
import { backendRoot, repositoryRoot, portfolioPolicyStoreDirectory, PortfolioBusyError, readJson, withPortfolioLock, writeJsonAtomic } from './paper-store';

export const implementationPackage = path.join(repositoryRoot, 'docs/audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z');
const dailyCsvPath = path.join(repositoryRoot, 'docs/audits/futures-quick-win/source-replication-20261014T032757Z/data/prices.csv');
export function selectedPortfolioPaperPolicy(): PortfolioPaperPolicyId { return normalizePortfolioPaperPolicy(process.env.PORTFOLIO_PAPER_POLICY); }
function files(policyId = selectedPortfolioPaperPolicy(), window?: CctTestbedWindow) {
  const directory = portfolioPolicyStoreDirectory(policyId);
  const testbedDirectory = window ? path.join(directory, 'testbeds', window) : directory;
  return { directory, walletFile: path.join(directory, 'wallet.json'), statusFile: path.join(directory, 'worker-status.json'),
    jobFile: path.join(testbedDirectory, 'testbed-job.json'), latestFile: path.join(testbedDirectory, 'latest-testbed.json'), testbedDirectory };
}

export interface StoredPortfolioWallet {
  config: PortfolioPaperConfig; state: PortfolioPaperState; summary: PortfolioPaperSummary;
  updatedAt: string; provenance: unknown; events: PortfolioPaperEvent[];
}
interface CctSourceExecutionCursor {
  scheduledExecuteAtMs: number; consumedAtMs: number; sourceId: string | null;
  disposition: 'submitted_once' | 'bootstrap_flat_until_next_utc';
}
export interface TestbedJob {
  id: string; status: 'running' | 'complete' | 'failed'; startedAt: string;
  completedAt?: string; pid?: number; error?: string;
  policyId?: PortfolioPaperPolicyId; window?: CctTestbedWindow; protocolSha256?: string;
}
export type CctTestbedWindow = 'dev64' | 'prior64' | 'continuous128';
export interface PortfolioTestbedRequest { policyId: typeof CCT_PAPER_POLICY.id; window: CctTestbedWindow }
const cctWindows: CctTestbedWindow[] = ['dev64', 'prior64', 'continuous128'];
export interface RegisteredCctTestbed { protocolPath: string; protocolSha256: string; outputDir: string }
export async function registeredCctTestbed(window: CctTestbedWindow): Promise<RegisteredCctTestbed> {
  if (!cctWindows.includes(window)) throw new Error('Unknown registered CCT window');
  const registryPath = process.env.PORTFOLIO_CCT_TESTBED_REGISTRY;
  if (!registryPath) throw new Error('CCT historical replay is not registered; no financial run was started');
  const registry = await readJson<{ policyId: string; windows: Partial<Record<CctTestbedWindow, RegisteredCctTestbed>> }>(registryPath);
  const item = registry?.windows?.[window];
  if (registry?.policyId !== CCT_PAPER_POLICY.id || !item || !/^[a-f0-9]{64}$/.test(item.protocolSha256)) throw new Error('CCT replay registry policy/window/hash is invalid');
  const protocolPath = path.resolve(path.dirname(registryPath), item.protocolPath);
  const body = await fs.readFile(protocolPath);
  if (createHash('sha256').update(body).digest('hex') !== item.protocolSha256) throw new Error('Registered CCT protocol hash mismatch');
  const protocol = JSON.parse(body.toString('utf8')) as { windowId?: string; policyId?: string };
  if (protocol.windowId !== window || protocol.policyId !== CCT_PAPER_POLICY.id) throw new Error('Registered CCT protocol identity mismatch');
  return { ...item, protocolPath, outputDir: path.resolve(path.dirname(registryPath), item.outputDir) };
}

/** The queued identity stays authoritative if an operator changes the registry before child startup. */
export async function queuedCctTestbedRegistration(jobId: string, request: PortfolioTestbedRequest, expectedSha256: string): Promise<RegisteredCctTestbed> {
  const { jobFile } = files(request.policyId, request.window);
  const job = await readJson<TestbedJob>(jobFile);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || !jobId || job?.id !== jobId || job.status !== 'running'
    || job.policyId !== request.policyId || job.window !== request.window || job.protocolSha256 !== expectedSha256) {
    throw new Error('Queued CCT testbed expectation mismatch; replay was not started');
  }
  const registration = await registeredCctTestbed(request.window);
  if (registration.protocolSha256 !== expectedSha256) throw new Error('CCT protocol registration changed after enqueue; replay was not started');
  return registration;
}

export function portfolioPaperEnabled(): boolean { return process.env.PORTFOLIO_PAPER_ENABLED !== 'false'; }

function presentTestbed(report: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!report) return null;
  const sourceCases = report.cases as Record<string, { summary: PortfolioPaperSummary; metrics: unknown }>;
  return { ...report, period: { start: new Date(Number(report.startTimeMs)).toISOString(),
    end: new Date(Number(report.endTimeMs)).toISOString(), days: report.calendarDays },
    cases: Object.entries(sourceCases).map(([name, item]) => ({ name,
      netPnl: item.summary.netPnl, meanDailyPnl: item.summary.meanNetPerCalendarDay,
      fees: item.summary.totalFees, funding: item.summary.fundingPnl, slippage: item.summary.totalSlippage,
      worstDay: item.summary.worstDayNetPnl, budgetBreaches: item.summary.maxDailyBreachUsd,
      fills: item.summary.fillCount, summary: item.summary, metrics: item.metrics,
    })) };
}

export async function portfolioPaperStatus(request?: PortfolioTestbedRequest): Promise<Record<string, unknown>> {
  const policyId = selectedPortfolioPaperPolicy();
  const cct = policyId === CCT_PAPER_POLICY.id;
  if (request && (request.policyId !== CCT_PAPER_POLICY.id || !cctWindows.includes(request.window))) throw new Error('Unknown registered CCT report window');
  const { walletFile, statusFile } = files(policyId);
  const reportPolicy = request?.policyId ?? policyId;
  const reportWindow = request?.window ?? (cct ? 'continuous128' : undefined);
  const { jobFile, latestFile } = files(reportPolicy, reportWindow);
  const [wallet, job, latestTestbed, worker] = await Promise.all([
    readJson<StoredPortfolioWallet>(walletFile), readJson<TestbedJob>(jobFile),
    readJson<Record<string, unknown>>(latestFile), readJson<Record<string, unknown>>(statusFile),
  ]);
  const validReport = !latestTestbed || reportPolicy === 'momentum-v1'
    || latestTestbed.policyId === reportPolicy && latestTestbed.windowId === reportWindow;
  const testbedAvailable = reportPolicy === 'momentum-v1' || await registeredCctTestbed(reportWindow!).then(() => true, () => false);
  return {
    mode: 'paper', enabled: portfolioPaperEnabled(), policyId,
    policy: { initialBalance: 100, dailyLossLimit: 10, timezone: 'Asia/Ho_Chi_Minh', ordersLimited: false },
    config: cct ? { ...CCT_PAPER_POLICY, displayName: 'CCT LC · BTC / ETH / BNB / SOL / XRP',
      symbols: CCT_RUNTIME_SYMBOLS, sourceScalar: 6, bandPercent: 20, feeRate: '0.0005', slippageBps: 2,
      timing: 'Closed UTC day → next UTC open', checkpointVersion: CCT_PAPER_POLICY.id,
    } : { displayName: 'Momentum · 40 coin', strategy: 'momentum-v1', sourceRevision: SOURCE_MOMENTUM_REVISION, symbols: SOURCE_UNIVERSE, momentumDays: 14,
      volatilityDays: 30, sourceGross: 2, executionVersion: 'nearest-lot-delta-paper-v1',
      feeRate: '0.0005', slippageBps: 2, leverageAssumption: 10 },
    state: wallet?.state ?? null, summary: wallet ? { ...wallet.summary, slippage: wallet.summary.totalSlippage } : null, updatedAt: wallet?.updatedAt ?? null,
    provenance: wallet?.provenance ?? null, recentEvents: wallet?.events.slice(-100) ?? [],
    latestTestbed: validReport ? presentTestbed(latestTestbed) : null, testbedJob: job, worker,
    testbedArtifactStatus: validReport ? 'identity_verified' : 'policy_or_window_mismatch',
    testbed: reportPolicy === CCT_PAPER_POLICY.id ? { policyId: reportPolicy, available: testbedAvailable, defaultWindow: reportWindow, windows: cctWindows,
      request: { policyId: reportPolicy, window: reportWindow }, label: reportWindow === 'continuous128' ? 'CCT · 128 ngày liên tục' : `CCT · ${reportWindow} · 64 ngày` }
      : { available: true, request: { days: 14 }, label: 'Momentum · 14 ngày' },
  };
}

/** Simulated fills only. This module has no import of order/private-account/LLM services. */
export async function advancePortfolioPaper(): Promise<StoredPortfolioWallet> {
  if (!portfolioPaperEnabled()) throw new Error('Portfolio paper is disabled');
  const policyId = selectedPortfolioPaperPolicy(), cct = policyId === CCT_PAPER_POLICY.id;
  const { directory, walletFile } = files(policyId);
  return withPortfolioLock(directory, async () => {
    const prior = await readJson<StoredPortfolioWallet>(walletFile);
    if (prior && (prior.config.policyId ?? 'momentum-v1') !== policyId) throw new Error('Paper checkpoint policy mismatch; explicit versioned migration required');
    if (cct && prior && !(prior.provenance as { sourceBridge?: unknown } | undefined)?.sourceBridge) throw new Error('CCT wallet is missing its atomic source cursor; reconciliation is required');
    const priorSourceExecution = (prior?.provenance as { cctSourceExecution?: CctSourceExecutionCursor } | undefined)?.cctSourceExecution;
    if (cct && prior && !priorSourceExecution) throw new Error('CCT wallet is missing its consumed source execution cursor; reconciliation is required');
    const lastCursor = Number((prior?.provenance as Record<string, unknown> | undefined)?.fundingThroughMs ?? prior?.state.lastTime ?? Date.now());
    // Overlap queries to detect delayed public settlement publication; dedup belongs to the wallet.
    const marketOptions = { dailyCsvPath,
      fundingAfterMs: prior ? Math.max(prior.state.startedAt ?? lastCursor, lastCursor - 3_600_000) : lastCursor,
      // A closed CCT contract can publish a settlement late, when it still had inventory.
      // Keep B5 coverage after flattening so reconciliation can detect that debt.
      fundingSymbols: cct ? CCT_RUNTIME_SYMBOLS : Object.keys(prior?.state.positions ?? {}),
    };
    const market = cct ? await loadCctCurrentMarket({ ...marketOptions,
      sourceBridge: (prior?.provenance as { sourceBridge?: CctSourceBridgeCheckpoint } | undefined)?.sourceBridge })
      : await loadCurrentMarket(marketOptions);
    const config: PortfolioPaperConfig = prior?.config ?? (cct ? buildCctPaperConfig(market.filters) : {
      initialCash: '100', dailyLossLimitUsd: '10', feeRate: '0.0005', slippageBps: '2',
      leverage: '10', maintenanceRate: '0.005', closeBufferUsd: '0.10', filters: market.filters,
    });
    // A filter change needs an explicit migration. Do not continue using obsolete broker rules.
    if (prior && JSON.stringify(config.filters) !== JSON.stringify(market.filters)) {
      throw new Error('Exchange filters changed; paper wallet needs a versioned filter migration');
    }
    const events: PortfolioPaperEvent[] = [];
    const dayMs = 86_400_000;
    const ictOffset = 7 * 3_600_000;
    const boundary = Math.floor((market.time + ictOffset) / dayMs) * dayMs - ictOffset;
    const ignoredZeroInventoryFunding: string[] = [];
    const unseenFunding = market.fundingAvailable.filter(item => {
      if (prior?.state.processedFundingIds.includes(item.id)) return false;
      if (prior?.state.lastTime !== null && prior?.state.lastTime !== undefined && item.time <= prior.state.lastTime) {
        // A newly opened contract can return earlier settlements when the query overlaps.
        // Only an independently reconstructed zero quantity may skip that older payment.
        const quantityThen = prior.events.filter(event => event.kind === 'fill' && event.symbol === item.symbol && event.time < item.time)
          .reduce((quantity, event) => quantity.plus(event.quantity ?? '0'), new Decimal('0'));
        if (!quantityThen.isZero()) throw new Error('Delayed funding settlement predates the checkpoint; reconciliation is required before new paper fills');
        prior.state.processedFundingIds.push(item.id); ignoredZeroInventoryFunding.push(item.id); return false;
      }
      return true;
    });
    const engine = new PortfolioPaperEngine(config, prior?.state);
    if (prior?.state.lastTime !== null && prior?.state.lastTime !== undefined && boundary - prior.state.lastTime > dayMs) {
      throw new Error('Paper monitoring gap crossed multiple ICT days; historical reconciliation is required');
    }
    const timeline = new Set(unseenFunding.map(item => item.time));
    if (prior?.state.lastTime !== null && prior?.state.lastTime !== undefined && boundary > prior.state.lastTime) timeline.add(boundary);
    const boundaryReceipts: unknown[] = [];
    for (const time of [...timeline].sort((a, b) => a - b)) {
      const settlements = unseenFunding.filter(item => item.time === time);
      let marks = engine.snapshot().marks;
      if (time === boundary) {
        const anchor = cct ? await loadBoundaryMarks(time, CCT_RUNTIME_SYMBOLS) : await loadBoundaryMarks(time);
        marks = anchor.marks; boundaryReceipts.push(anchor.provenance);
      } else {
        marks = { ...marks };
        for (const item of settlements) if (item.markPrice) marks[item.symbol] = item.markPrice;
      }
      events.push(...engine.step({ id: `settlement-anchor:${time}`, time, marks, funding: settlements }).events);
    }
    const executeAtMs = Math.floor(market.time / 86_400_000) * 86_400_000;
    if (cct && priorSourceExecution && priorSourceExecution.scheduledExecuteAtMs > executeAtMs) throw new Error('CCT source execution cursor is ahead of public time');
    const bootstrapFlat = cct && !prior && market.time !== executeAtMs;
    const targets = cct && (bootstrapFlat || priorSourceExecution?.scheduledExecuteAtMs === executeAtMs)
      ? null : cct ? buildCctSourceTargets(market.closedDailyRows, executeAtMs) : buildSourceTargets(market.closedDailyRows, executeAtMs);
    const cctSourceExecution: CctSourceExecutionCursor | undefined = !cct ? undefined : targets || bootstrapFlat ? {
      scheduledExecuteAtMs: executeAtMs, consumedAtMs: market.time, sourceId: targets?.sourceId ?? null,
      disposition: bootstrapFlat ? 'bootstrap_flat_until_next_utc' : 'submitted_once',
    } : priorSourceExecution;
    if (cct) {
      const quoteTimes = market.provenance.quoteTimes as Record<string, { markTimeMs: number; tradeTimeMs: number }> | undefined;
      const now = Date.now();
      if (!quoteTimes || !CCT_RUNTIME_SYMBOLS.every(symbol => quoteTimes[symbol]
        && [quoteTimes[symbol].markTimeMs, quoteTimes[symbol].tradeTimeMs].every(time => Number.isSafeInteger(time) && now - time <= 30_000 && time - now <= 5_000))) {
        throw new Error('CCT venue quotes are stale after source/recovery processing; paper fills are blocked');
      }
    }
    const result = engine.step({ id: `public:${market.time}`, time: market.time,
      marks: market.marks, tradePrices: market.tradePrices,
      ...(!targets || prior?.state.lastTargets?.sourceId === targets.sourceId ? {} : {
        targets: { ...targets, scheduledExecuteAtMs: executeAtMs, executeAtMs: market.time },
      }),
    });
    const wallet: StoredPortfolioWallet = {
      config, state: result.snapshot, summary: engine.summary(), updatedAt: new Date(market.time).toISOString(),
      provenance: { ...market.provenance, ...('sourceBridge' in market ? { sourceBridge: market.sourceBridge } : {}),
        ...(cct ? { cctSourceExecution } : {}),
        policyId, boundaryReceipts, ignoredZeroInventoryFunding, mode: 'public_quote_paper',
        continuousRiskMonitoring: false, initialDayPartial: true,
        lateScheduledEntryMs: market.time - executeAtMs,
        fundingDuringUnobservedIntervals: 'chronological_against_last_persisted_inventory',
        midnightHistoricalRecovery: boundaryReceipts.length > 0 },
      events: [...(prior?.events ?? []), ...events, ...result.events],
    };
    await writeJsonAtomic(walletFile, wallet);
    return wallet;
  });
}

export async function recordPaperWorkerStatus(status: Record<string, unknown>): Promise<void> {
  const { statusFile } = files();
  await writeJsonAtomic(statusFile, { ...status, updatedAt: new Date().toISOString() });
}

/** API requests enqueue the fixed registered historical run; they cannot change capital, universe or risk. */
export async function startPortfolioTestbed(request?: PortfolioTestbedRequest): Promise<TestbedJob> {
  const policyId = request?.policyId ?? 'momentum-v1';
  if (request && (policyId !== CCT_PAPER_POLICY.id || !cctWindows.includes(request.window))) throw new Error('Unknown registered paper testbed');
  const registration = request ? await registeredCctTestbed(request.window) : null;
  const { jobFile, latestFile } = files(policyId, request?.window);
  return withPortfolioLock(path.join(portfolioPolicyStoreDirectory(), 'testbed-control'), async () => {
    // A single historical worker across all windows keeps API requests from exhausting this host.
    const jobs = await Promise.all([files('momentum-v1').jobFile, ...cctWindows.map(window => files(CCT_PAPER_POLICY.id, window).jobFile)]
      .filter(file => file !== jobFile).map(file => readJson<TestbedJob>(file)));
    for (const active of jobs) if (active?.status === 'running' && active.pid) {
      try { process.kill(active.pid, 0); throw new PortfolioBusyError(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    const prior = await readJson<TestbedJob>(jobFile);
    if (prior?.status === 'running' && prior.pid) {
      try { process.kill(prior.pid, 0); return prior; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    // Reuse completed financial outputs for this exact registered window/config.
    const priorReport = await readJson<{ policyId?: string; windowId?: string; protocolSha256?: string }>(latestFile);
    if (prior?.status === 'complete' && priorReport && (!request || (priorReport.policyId === policyId
      && priorReport.windowId === request.window && priorReport.protocolSha256 === registration?.protocolSha256
      && prior.protocolSha256 === registration?.protocolSha256))) return prior;
    const id = randomUUID();
    const job: TestbedJob = { id, status: 'running', startedAt: new Date().toISOString(),
      ...(request ? { policyId, window: request.window, protocolSha256: registration!.protocolSha256 } : {}) };
    await writeJsonAtomic(jobFile, job);
    const script = path.join(__dirname, 'testbed-worker.js');
    const child = fork(script, [], { cwd: backendRoot, silent: true,
      execArgv: ['--max-old-space-size=256'],
      env: { ...process.env, PORTFOLIO_TESTBED_JOB_ID: id, PORTFOLIO_TESTBED_POLICY: policyId,
        PORTFOLIO_TESTBED_WINDOW: request?.window ?? '', PORTFOLIO_TESTBED_PROTOCOL_SHA256: registration?.protocolSha256 ?? '' },
    });
    job.pid = child.pid;
    await writeJsonAtomic(jobFile, job);
    child.stdout?.resume();
    let errorTail = '';
    child.stderr?.on('data', (chunk: Buffer) => { errorTail = `${errorTail}${chunk.toString()}`.slice(-2000); });
    child.on('error', (error) => { void markTestbedFailed(id, error.message, request); });
    child.on('exit', (code) => {
      if (code !== 0) void markTestbedFailed(id, errorTail || `Testbed exited with code ${code}`, request);
    });
    child.unref();
    return job;
  });
}

export async function markTestbedFailed(id: string, error: string, request?: PortfolioTestbedRequest): Promise<void> {
  const { jobFile } = files(request?.policyId ?? 'momentum-v1', request?.window);
  const job = await readJson<TestbedJob>(jobFile);
  if (job?.id !== id || job.status !== 'running') return;
  await writeJsonAtomic(jobFile, { ...job, status: 'failed', error, completedAt: new Date().toISOString() });
}

export async function publishTestbed(report: unknown, request?: PortfolioTestbedRequest): Promise<void> {
  const { latestFile, jobFile } = files(request?.policyId ?? 'momentum-v1', request?.window);
  const job = await readJson<TestbedJob>(jobFile);
  if (request) {
    const identity = report as { policyId?: string; windowId?: string; protocolSha256?: string };
    if (identity.policyId !== request.policyId || identity.windowId !== request.window || job?.status !== 'running'
      || job.policyId !== request.policyId || job.window !== request.window || job.protocolSha256 !== identity.protocolSha256) throw new Error('CCT report/job identity mismatch; refuse publish');
  }
  await writeJsonAtomic(latestFile, report);
  if (job) await writeJsonAtomic(jobFile, { ...job, status: 'complete', completedAt: new Date().toISOString() });
}
