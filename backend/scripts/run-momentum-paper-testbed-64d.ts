/** Accelerated paper testbed: the runtime paper engine consumes historical data.
 * This is an execution adaptation, not a rerun/change of the frozen source model.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { PortfolioPaperEngine } from '../src/portfolio/paper-engine';
import { buildSourceTargets, SOURCE_MOMENTUM_REVISION } from '../src/portfolio/source-momentum';
import { DAY_MS, FIVE_MINUTES_MS, loadHistoricalMarketData, streamHistoricalFrames } from '../src/portfolio/market-data';
import type { PortfolioPaperConfig, PortfolioPaperResult, PortfolioPaperState, PortfolioPaperSummary } from '../src/portfolio/types';

const REPOSITORY = resolve(__dirname, '../..');
const START = Date.parse('2026-08-10T17:00:00.000Z');
const END = Date.parse('2026-10-13T17:00:00.000Z');
const COMMON_CONFIG = { initialCash: '100', dailyLossLimitUsd: '10', leverage: '10', maintenanceRate: '0.005', closeBufferUsd: '0.10' };
const EXECUTION_CASES = { base: { feeRate: '0.0005', slippageBps: '2' }, stress: { feeRate: '0.0007', slippageBps: '5' } };

export interface HistoricalPaperCaseReport {
  summary: PortfolioPaperSummary;
  config: Omit<PortfolioPaperConfig, 'filters'>;
  metrics: {
    frames: number; engineSteps: number; emittedEvents: number; sourceRebalances: number;
    fundingSettlements: number; fundingMarkFallbacks: number; dailyBudgetBreached: boolean;
    peakGrossNotional: string; peakGrossEquityRatio: number; peakTrackingErrorWeight: number;
    meanTrackingErrorWeight: number; missingMidnightAnchors: number; runtimeMs: number;
  };
  files: Record<string, string>;
}
export interface HistoricalPaperReport {
  status: 'COMPLETE_ACCELERATED_PAPER_TESTBED';
  createdUtc: string;
  protocolSha256: string;
  sourceRevision: string;
  startTimeMs: number;
  endTimeMs: number;
  calendarDays: number;
  cases: Record<'base' | 'stress', HistoricalPaperCaseReport>;
  data: Record<string, unknown>;
  limitations: string[];
}
interface ReplayProtocol {
  status: string;
  inputs: Array<{ path: string; sha256: string }>;
  commonConfig: typeof COMMON_CONFIG;
  cases: typeof EXECUTION_CASES;
  period: { start: string; end_exclusive: string; days: number; timezone: string };
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
function digest(body: Buffer): string { return createHash('sha256').update(body).digest('hex'); }
async function verifyProtocol(path: string): Promise<string> {
  const body = await readFile(path);
  const protocol = JSON.parse(body.toString('utf8')) as ReplayProtocol;
  assert(protocol.status === 'REGISTERED_BEFORE_PNL' && Array.isArray(protocol.inputs) && protocol.inputs.length > 0, 'Financial protocol not registered before PnL');
  assert(Date.parse(protocol.period.start) === START && Date.parse(protocol.period.end_exclusive) === END && protocol.period.days === 64 && protocol.period.timezone === 'Asia/Ho_Chi_Minh', 'Unregistered64-day period');
  for (const input of protocol.inputs) {
    const source = await readFile(resolve(REPOSITORY, input.path));
    assert(digest(source) === input.sha256, `Registered input changed: ${input.path}`);
  }
  for (const [key, value] of Object.entries(COMMON_CONFIG)) {
    assert(Number(protocol.commonConfig?.[key as keyof typeof COMMON_CONFIG]) === Number(value), `Unregistered common execution config ${key}`);
  }
  for (const name of ['base', 'stress'] as const) {
    for (const [key, value] of Object.entries(EXECUTION_CASES[name])) {
      assert(Number(protocol.cases?.[name]?.[key as keyof typeof EXECUTION_CASES.base]) === Number(value), `Unregistered execution case ${name}.${key}`);
    }
  }
  return digest(body);
}
class JsonLines {
  private readonly output: ReturnType<typeof createWriteStream>;
  constructor(path: string) { this.output = createWriteStream(path, { flags: 'wx' }); }
  async append(value: unknown): Promise<void> {
    if (!this.output.write(`${JSON.stringify(value)}\n`)) await once(this.output, 'drain');
  }
  async close(): Promise<void> { this.output.end(); await once(this.output, 'finish'); }
  destroy(): void { this.output.destroy(); }
}
function barPrices(bars: Record<string, { open: string; high: string; low: string; close: string }>, field: 'open' | 'close'): Record<string, string> {
  return Object.fromEntries(Object.entries(bars).map(([symbol, bar]) => [symbol, bar[field]]));
}
function adversePrices(bars: Record<string, { high: string; low: string; open: string }>, state: PortfolioPaperState): Record<string, string> {
  return Object.fromEntries(Object.entries(bars).map(([symbol, bar]) => [symbol,
    Number(state.positions[symbol]?.quantity ?? 0) > 0 ? bar.low : Number(state.positions[symbol]?.quantity ?? 0) < 0 ? bar.high : bar.open]));
}

async function runCase(name: 'base' | 'stress', dataset: Awaited<ReturnType<typeof loadHistoricalMarketData>>, outputDir: string,
  onProgress?: (progress: { case: string; frames: number; totalFrames: number }) => void): Promise<HistoricalPaperCaseReport> {
  const started = Date.now();
  const directory = join(outputDir, name);
  await mkdir(directory, { recursive: true });
  const events = new JsonLines(join(directory, 'events.ndjson'));
  const frames = new JsonLines(join(directory, 'frames.ndjson'));
  const targets = new JsonLines(join(directory, 'targets.ndjson'));
  const config = { ...COMMON_CONFIG, ...EXECUTION_CASES[name] };
  let engine = new PortfolioPaperEngine({ ...config, filters: dataset.filters });
  let frameCount = 0, steps = 0, emittedEvents = 0, sourceRebalances = 0, fundingSettlements = 0, fundingMarkFallbacks = 0;
  let peakGross = 0, peakRatio = 0, peakTracking = 0, sumTracking = 0;
  let latest: PortfolioPaperState = engine.snapshot();
  const stepIds = new Set<string>();
  const stepRegistry = new JsonLines(join(directory, 'step-ids.ndjson'));
  let compactedStepIds = 0;
  const record = async (result: PortfolioPaperResult): Promise<void> => {
    for (const id of result.snapshot.processedStepIds.slice(-1)) {
      assert(!stepIds.has(id), 'Duplicate deterministic replay step ID');
      stepIds.add(id); await stepRegistry.append({ id, time: result.snapshot.lastTime });
    }
    steps += 1;
    latest = result.snapshot;
    for (const event of result.events) { await events.append(event); emittedEvents += 1; }
    peakGross = Math.max(peakGross, Number(latest.grossNotional));
    if (Number(latest.equity) > 0) peakRatio = Math.max(peakRatio, Number(latest.grossNotional) / Number(latest.equity));
  };
  try {
    for await (const frame of streamHistoricalFrames(dataset)) {
      // Offline memory optimization only: all dedup IDs remain in this run's global registry.
      // Restore before the midnight step; never reset positions, cash, funding IDs, anchors or latch.
      if (frame.openTimeMs > START && (frame.openTimeMs + 7 * 3_600_000) % DAY_MS === 0) {
        const restored = engine.snapshot();
        compactedStepIds += restored.processedStepIds.length;
        restored.processedStepIds = [];
        engine = new PortfolioPaperEngine({ ...config, filters: dataset.filters }, restored);
      }
      const openMarks = barPrices(frame.mark, 'open');
      const openTrades = barPrices(frame.trade, 'open');
      const openingFunding = frame.funding.filter((item) => item.time === frame.openTimeMs);
      await record(engine.step({ id: `${name}:${frame.openTimeMs}:open`, time: frame.openTimeMs, marks: openMarks, tradePrices: openTrades,
        funding: openingFunding.map((item) => ({ id: item.id, symbol: item.symbol, rate: item.rate, markPrice: item.markPrice ?? openMarks[item.symbol] })) }));
      fundingSettlements += openingFunding.length;
      fundingMarkFallbacks += openingFunding.filter((item) => !item.markPrice).length;
      if (frame.openTimeMs % DAY_MS === 0) {
        const desired = buildSourceTargets(dataset.dailyRows, frame.openTimeMs);
        await record(engine.step({ id: `${name}:${frame.openTimeMs}:source-rebalance`, time: frame.openTimeMs, marks: openMarks, tradePrices: openTrades, targets: desired }));
        sourceRebalances += 1;
        const equity = Number(latest.equity);
        let tracking = 0, netWeight = 0, grossWeight = 0;
        for (const [symbol, targetWeight] of Object.entries(desired.weights)) {
          const actualWeight = equity > 0 ? Number(latest.positions[symbol]?.quantity ?? 0) * Number(openMarks[symbol]) / equity : 0;
          tracking += Math.abs(actualWeight - targetWeight);
          netWeight += actualWeight; grossWeight += Math.abs(actualWeight);
        }
        peakTracking = Math.max(peakTracking, tracking); sumTracking += tracking;
        await targets.append({ time: frame.openTimeMs, source: desired, actualPositions: latest.positions, equity: latest.equity,
          actualGrossWeight: grossWeight, actualNetWeight: netWeight, absoluteTrackingErrorWeight: tracking, trackingErrorFractionOfSourceGross: tracking / 2 });
      }
      for (const event of frame.funding.filter((item) => item.time > frame.openTimeMs)) {
        await record(engine.step({ id: `${name}:${event.id}`, time: event.time, marks: openMarks, tradePrices: openTrades,
          funding: [{ id: event.id, symbol: event.symbol, rate: event.rate, markPrice: event.markPrice ?? openMarks[event.symbol] }] }));
        fundingSettlements += 1;
        if (!event.markPrice) fundingMarkFallbacks += 1;
      }
      // The same engine enforces risk at the conservative5m adverse envelope.
      // Combining per-symbol extremes is not a claim of synchronized actual ticks.
      const adverseTime = Math.max(frame.endTimeMs - 2, latest.lastTime ?? frame.openTimeMs);
      await record(engine.step({ id: `${name}:${frame.openTimeMs}:adverse`, time: adverseTime,
        marks: adversePrices(frame.mark, latest), tradePrices: adversePrices(frame.trade, latest) }));
      const closeTime = frame.endTimeMs - 1;
      await record(engine.step({ id: `${name}:${frame.openTimeMs}:close`, time: closeTime,
        marks: barPrices(frame.mark, 'close'), tradePrices: barPrices(frame.trade, 'close'),
        ...(frame.endTimeMs === END ? { forceClose: 'terminal_testbed_liquidation' } : {}) }));
      frameCount += 1;
      await frames.append({ time: closeTime, equity: latest.equity, cash: latest.cash, grossNotional: latest.grossNotional,
        marginUsed: latest.marginUsed, totalFees: latest.totalFees, fundingPnl: latest.fundingPnl,
        realizedPnl: latest.realizedPnl, currentDay: latest.currentDay, positions: latest.positions });
      if (frameCount % 288 === 0) onProgress?.({ case: name, frames: frameCount, totalFrames: dataset.manifest.barsPerSymbol });
    }
    assert(frameCount === dataset.manifest.barsPerSymbol && latest.lastTime === END - 1, 'Testbed window incomplete');
    assert(Object.keys(latest.positions).length === 0, 'Terminal positions were not liquidated');
    const summary = engine.summary();
    assert(summary.calendarDays === 64, 'Calendar-day denominator must include all64ICTdays');
    const days = [...latest.days, ...(latest.currentDay ? [latest.currentDay] : [])];
    const report: HistoricalPaperCaseReport = { summary, config,
      metrics: { frames: frameCount, engineSteps: steps, emittedEvents, sourceRebalances, fundingSettlements,
        fundingMarkFallbacks, dailyBudgetBreached: Number(summary.maxDailyBreachUsd) > 0,
        peakGrossNotional: String(peakGross), peakGrossEquityRatio: peakRatio, peakTrackingErrorWeight: peakTracking,
        meanTrackingErrorWeight: sourceRebalances ? sumTracking / sourceRebalances : 0,
        missingMidnightAnchors: days.filter((day) => day.anchorQuality === 'missing_midnight').length, runtimeMs: Date.now() - started },
      files: { stepIds: join(directory, 'step-ids.ndjson'), events: join(directory, 'events.ndjson'), frames: join(directory, 'frames.ndjson'), targets: join(directory, 'targets.ndjson'),
        checkpoint: join(directory, 'checkpoint.json'), days: join(directory, 'days.json'), report: join(directory, 'report.json') } };
    assert(stepIds.size === steps && compactedStepIds + latest.processedStepIds.length === steps, 'Incomplete global step identity registry');
    await Promise.all([events.close(), frames.close(), targets.close(), stepRegistry.close()]);
    await writeFile(report.files.checkpoint, `${JSON.stringify(latest, null, 2)}\n`, { flag: 'wx' });
    await writeFile(report.files.days, `${JSON.stringify(days, null, 2)}\n`, { flag: 'wx' });
    await writeFile(report.files.report, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    return report;
  } catch (error) { events.destroy(); frames.destroy(); targets.destroy(); stepRegistry.destroy(); throw error; }
}

export async function runHistoricalPaperTestbed64d(options: {
  dataDir: string; outputDir: string; dailyCsvPath?: string; protocolPath?: string;
  onProgress?: (progress: { case: string; frames: number; totalFrames: number }) => void;
}): Promise<HistoricalPaperReport> {
  const outputDir = resolve(options.outputDir);
  const protocolPath = resolve(options.protocolPath ?? join(options.dataDir, '..', 'protocol.json'));
  const protocolSha256 = await verifyProtocol(protocolPath);
  const dataset = await loadHistoricalMarketData(options.dataDir);
  assert(dataset.manifest.startTimeMs === START && dataset.manifest.endTimeMs === END && dataset.manifest.barIntervalMs === FIVE_MINUTES_MS, 'Only fixed preregistered64-day window allowed');
  if (options.dailyCsvPath) {
    assert(digest(await readFile(options.dailyCsvPath)) === digest(await readFile(join(dataset.directory, 'daily-source.csv'))), 'External dailywarmup differs from registered dataset');
  }
  const reportPath = join(outputDir, 'report.json');
  assert(!await exists(reportPath), 'Completed64-day results already exist; read the frozen report instead of rerunning');
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'execution-registration.json'), `${JSON.stringify({ status: 'REGISTERED_BEFORE_CASES', createdUtc: new Date().toISOString(),
    protocolPath, protocolSha256, startTimeMs: START, endTimeMs: END, cases: EXECUTION_CASES, commonConfig: COMMON_CONFIG }, null, 2)}\n`, { flag: 'wx' });
  const base = await runCase('base', dataset, outputDir, options.onProgress);
  const stress = await runCase('stress', dataset, outputDir, options.onProgress);
  const report: HistoricalPaperReport = { status: 'COMPLETE_ACCELERATED_PAPER_TESTBED', createdUtc: new Date().toISOString(), protocolSha256,
    sourceRevision: SOURCE_MOMENTUM_REVISION, startTimeMs: START, endTimeMs: END, calendarDays: 64, cases: { base, stress },
    data: { directory: dataset.directory, symbols: dataset.manifest.symbols, rawCandles: dataset.manifest.rawCandles,
      barsPerSymbol: dataset.manifest.barsPerSymbol, fundingEvents: dataset.manifest.fundingEvents, dailyRows: dataset.manifest.dailyRows },
    limitations: [...dataset.manifest.limitations, 'Historical accelerated workflow check over already accessible data; not a prospective64-day trading record.',
      'Source raw signals/ranks/exact lag/gross2 preserved; executable lot projection/governor change actual holdings and returns.',
      'Funding at exact interval open occurs before UTC target rebalance; other settlement marks use public markPrice, open-mark fallback explicitly counted.',
      'Adverse envelope precedes interval close; terminal closing occurs at final full candle closing timestamp END-1 to avoid a65th calendar day.'] };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const packageDir = resolve(option('package-dir') ?? '../docs/audits/futures-quick-win/momentum-paper-64d-20261014T140124Z');
  const report = await runHistoricalPaperTestbed64d({ dataDir: join(packageDir, 'data'), outputDir: join(packageDir, 'outputs'), protocolPath: join(packageDir, 'protocol.json'),
    onProgress: progress => console.log(JSON.stringify({ phase: 'replay', ...progress, utc: new Date().toISOString() })) });
  console.log(JSON.stringify({ status: report.status, calendarDays: report.calendarDays, cases: Object.fromEntries(Object.entries(report.cases).map(([name, result]) => [name, result.summary])) }, null, 2));
}
if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
