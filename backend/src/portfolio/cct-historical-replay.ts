/** Registered CCT replay adapter. All monetary transitions use the runtime engine. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Decimal } from '@prisma/client/runtime/library';
import { PortfolioPaperEngine } from './paper-engine';
import { buildCctPaperConfig, CCT_PAPER_POLICY } from './policy-registry';
import { CCT_SOURCE_REVISION, CCT_SOURCE_SYMBOLS } from './source-cct';
import type { Numeric, PortfolioPaperEvent, PortfolioPaperWalletObservation, PortfolioPaperSummary, PortfolioPaperTransition, SourcePortfolioTargets, SymbolFilter } from './types';

const DAY = 86_400_000, MINUTE = 60_000, ICT = 25_200_000;
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const money = (n: Numeric): Decimal => new Money(n);
const CASES = { base: { feeRate: '0.0005', slippageBps: '2' }, stress: { feeRate: '0.0007', slippageBps: '5' } } as const;
export const CCT_TESTBED_WINDOWS = {
  prior64: { id: 'prior64', startTimeMs: 1780851600000, endTimeMs: 1786381200000, calendarDays: 64 },
  dev64: { id: 'dev64', startTimeMs: 1786381200000, endTimeMs: 1791910800000, calendarDays: 64 },
  continuous128: { id: 'continuous128', startTimeMs: 1780851600000, endTimeMs: 1791910800000, calendarDays: 128 },
} as const;
export type CctTestbedWindowId = keyof typeof CCT_TESTBED_WINDOWS;
export interface CctMinuteBar { open: string; high: string; low: string; close: string }
export interface CctMinuteFunding { id: string; time: number; symbol: string; rate: Numeric; markPrice: Numeric }
export interface CctMinuteFrame {
  openTimeMs: number; endTimeMs: number; mark: Record<string, CctMinuteBar>; trade: Record<string, CctMinuteBar>;
  funding: CctMinuteFunding[];
}
export interface CctReplayProtocol {
  status: 'REGISTERED_BEFORE_TS_REPLAY'; policyId: typeof CCT_PAPER_POLICY.id; windowId: CctTestbedWindowId;
  inputs: Array<{ path: string; sha256: string }>;
  data: { minuteShards: Array<{ manifestPath: string }>; targetsPaths: string[]; targetWeightMultiplier: '1' | '1.5'; fundingPaths: string[]; filtersPath: string };
  commonConfig: typeof CCT_PAPER_POLICY; cases: typeof CASES;
  /** Frozen recorded ledgers only. This adapter never invokes Python. */
  parityReferences?: Record<'base' | 'stress', { framesPath: string; eventsPath: string; summaryPath: string }>;
  monetaryToleranceUsd: string;
}
export interface CctHistoricalPaperCaseReport {
  summary: PortfolioPaperSummary; config: Omit<ReturnType<typeof buildCctPaperConfig>, 'filters'>;
  metrics: { frames: number; engineSteps: number; emittedEvents: number; sourceRebalances: number;
    fundingSettlements: number; fundingMarkFallbacks: number; dailyBudgetBreached: boolean;
    missingMidnightAnchors: number; runtimeMs: number; peakGrossNotionalAtMinuteClose: string; peakGrossEquityRatioAtMinuteClose: number;
    peakTrackingErrorWeight: number; meanTrackingErrorWeight: number };
  parity: { status: 'PASS' | 'NOT_REQUESTED'; frames: number; events: number; moneyChecks: number; maximumMonetaryErrorUsd: string; monetaryToleranceUsd: string };
  files: Record<string, string>;
}
export interface CctHistoricalPaperReport {
  status: 'COMPLETE_CCT_ACCELERATED_PAPER_TESTBED'; policyId: typeof CCT_PAPER_POLICY.id; windowId: CctTestbedWindowId;
  createdUtc: string; protocolSha256: string; sourceRevision: string; startTimeMs: number; endTimeMs: number; calendarDays: number;
  cases: Record<'base' | 'stress', CctHistoricalPaperCaseReport>; data: Record<string, unknown>; limitations: string[];
}
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
async function digest(path: string): Promise<string> {
  const hash = createHash('sha256'); for await (const body of createReadStream(path)) hash.update(body); return hash.digest('hex');
}
export async function* cctJsonLines(path: string): AsyncGenerator<Record<string, any>> {
  const input = createReadStream(path); const lines = createInterface({ input, crlfDelay: Infinity });
  try { for await (const line of lines) { if (line.trim()) yield JSON.parse(line) as Record<string, any>; } }
  finally { lines.close(); input.destroy(); }
}
class JsonLines {
  private output: ReturnType<typeof createWriteStream>;
  private failure?: Error;
  constructor(path: string) {
    this.output = createWriteStream(path, { flags: 'wx' });
    // A pending write can report ERR_STREAM_DESTROYED during cleanup after
    // a parity failure. Retain I/O errors without masking the original error.
    this.output.on('error', error => { this.failure = error; });
  }
  async append(value: unknown): Promise<void> {
    if (this.failure) throw this.failure;
    if (!this.output.write(`${JSON.stringify(value)}\n`)) await once(this.output, 'drain');
  }
  async close(): Promise<void> {
    if (this.failure) throw this.failure;
    this.output.end(); await once(this.output, 'finish');
  }
  destroy(): void { this.output.destroy(); }
}
function prices(bars: Record<string, CctMinuteBar>, field: 'open' | 'close'): Record<string, string> {
  return Object.fromEntries(Object.entries(bars).map(([s, bar]) => [s, bar[field]]));
}
function adverse(bars: Record<string, CctMinuteBar>, state: PortfolioPaperWalletObservation): Record<string, string> {
  return Object.fromEntries(Object.entries(bars).map(([s, bar]) => [s,
    money(state.positions[s]?.quantity ?? '0').gt(0) ? bar.low : money(state.positions[s]?.quantity ?? '0').lt(0) ? bar.high : bar.open]));
}

/** OPEN/ICT roll/funding → UTC target → exact-ms later funding → END−2 adverse → END−1 close. */
export function processCctMinuteFrame(engine: PortfolioPaperEngine, frame: CctMinuteFrame, options: {
  target?: SourcePortfolioTargets; final?: boolean; onTransition?: (result: PortfolioPaperTransition) => void;
} = {}): PortfolioPaperWalletObservation {
  const t = frame.openTimeMs;
  assert(t % MINUTE === 0 && frame.endTimeMs === t + MINUTE, 'CCT requires complete aligned1m frames');
  assert(CCT_SOURCE_SYMBOLS.every(s => frame.mark[s] && frame.trade[s]) && Object.keys(frame.mark).length === 5 && Object.keys(frame.trade).length === 5, 'CCT frame must cover B5 exactly');
  assert(new Set(frame.funding.map(f => f.id)).size === frame.funding.length && frame.funding.every(f => f.time >= t && f.time < frame.endTimeMs && CCT_SOURCE_SYMBOLS.includes(f.symbol as typeof CCT_SOURCE_SYMBOLS[number]) && money(f.markPrice).gt(0)), 'Invalid exact-ms CCT funding frame');
  if (t % DAY === 0) assert(options.target?.knownAtMs === t && options.target.executeAtMs === t && options.target.labelTimeMs === t - DAY, 'UTC CCT target missing or mistimed');
  else assert(!options.target, 'CCT target outside UTC midnight');
  if (options.target) {
    const target = options.target;
    assert(target.strategy === 'cct-lc-b5-v1' && target.sourceId && CCT_SOURCE_SYMBOLS.every(s => typeof target.metadata?.[s]?.signalCountChanged === 'boolean'), 'Invalid CCT target identity/metadata');
    for (const [s, w] of Object.entries(target.weights)) {
      assert(Number.isFinite(w) && (CCT_SOURCE_SYMBOLS.includes(s as typeof CCT_SOURCE_SYMBOLS[number]) || w === 0), 'Invalid CCT source weight');
      if (target.decimalWeights?.[s] !== undefined) assert(money(target.decimalWeights[s]).isFinite() && money(target.decimalWeights[s]).toNumber() === w, 'Inconsistent CCT decimal source weight');
    }
  }
  // Validate the complete candle before committing the first transition.
  for (const bars of [frame.mark, frame.trade]) for (const bar of Object.values(bars)) {
    for (const x of Object.values(bar)) assert(money(x).isFinite() && money(x).gt(0), 'Invalid CCT OHLC');
    assert(money(bar.low).lte(Decimal.min(money(bar.open), money(bar.close))) && money(bar.high).gte(Decimal.max(money(bar.open), money(bar.close))), 'Invalid CCT OHLC range');
  }
  const mo = prices(frame.mark, 'open'), to = prices(frame.trade, 'open');
  const step = (suffix: string, time: number, marks: Record<string, string>, tradePrices: Record<string, string>, extra: Record<string, unknown> = {}): void => {
    const result = engine.step({ id: `cct:${t}:${suffix}`, time, marks, tradePrices, ...extra }, { snapshot: false });
    options.onTransition?.(result);
  };
  step('open', t, mo, to, { funding: frame.funding.filter(f => f.time === t) });
  if (options.target) step('source', t, mo, to, { targets: options.target });
  for (const event of frame.funding.filter(f => f.time > t).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))) step(`funding:${event.id}`, event.time, mo, to, { funding: [event] });
  const state = engine.walletObservation();
  step('adverse', Math.max(frame.endTimeMs - 2, state.lastTime ?? t), adverse(frame.mark, state), adverse(frame.trade, state));
  step('close', frame.endTimeMs - 1, prices(frame.mark, 'close'), prices(frame.trade, 'close'), options.final ? { forceClose: 'terminal_testbed_liquidation' } : {});
  return engine.walletObservation();
}

interface MinuteManifest { startTimeMs: number; endTimeMs: number; barIntervalMs: number; symbols: string[]; mainFiles: Array<{ symbol: string; path: string; sha256: string; rows: number }> }
async function* csvRows(path: string): AsyncGenerator<Record<string, string>> {
  const input = createReadStream(path), lines = createInterface({ input, crlfDelay: Infinity }); let header: string[] | null = null;
  try { for await (const line of lines) { if (!line) continue; const cells = line.split(','); if (!header) { header = cells; continue; }
    assert(cells.length === header.length, `Malformed CCT minute CSV: ${path}`); yield Object.fromEntries(header.map((key, i) => [key, cells[i]])); } }
  finally { lines.close(); input.destroy(); }
}
export async function* streamCctMinuteFrames(shards: Array<{ manifest: MinuteManifest; directory: string }>, funding: CctMinuteFunding[]): AsyncGenerator<CctMinuteFrame> {
  let fp = 0;
  for (const { manifest, directory } of shards) {
    const readers = Object.fromEntries(manifest.mainFiles.map(f => [f.symbol, csvRows(resolve(directory, f.path))]));
    try {
      for (let t = manifest.startTimeMs; t < manifest.endTimeMs; t += MINUTE) {
        const mark: Record<string, CctMinuteBar> = {}, trade: Record<string, CctMinuteBar> = {};
        for (const s of CCT_SOURCE_SYMBOLS) {
          const row = (await readers[s].next()).value; assert(row && Number(row.openTimeMs) === t, `CCT CSV gap/overlap ${s}:${t}`);
          for (const [kind, target] of [['mark', mark], ['trade', trade]] as const) target[s] = { open: row[`${kind}Open`], high: row[`${kind}High`], low: row[`${kind}Low`], close: row[`${kind}Close`] };
        }
        const settled: CctMinuteFunding[] = [];
        while (fp < funding.length && funding[fp].time < t + MINUTE) { assert(funding[fp].time >= t, 'CCT funding before frame'); settled.push(funding[fp++]); }
        yield { openTimeMs: t, endTimeMs: t + MINUTE, mark, trade, funding: settled };
      }
      for (const s of CCT_SOURCE_SYMBOLS) assert((await readers[s].next()).done, `CCT CSV extra rows ${s}`);
    } finally { for (const reader of Object.values(readers)) await reader.return(undefined); }
  }
  assert(fp === funding.length, 'Unconsumed CCT funding');
}

/** Compare recorded money/state; this never reruns the frozen Python engines. */
export class CctRecordedParity {
  moneyChecks = 0; frames = 0; events = 0; maximumError = money(0);
  private readonly toleranceValue: Decimal;
  constructor(readonly tolerance: string) {
    this.toleranceValue = money(tolerance);
    assert(this.toleranceValue.isFinite() && this.toleranceValue.gte(0) && this.toleranceValue.lte('1e-12'), 'Unacceptably broad CCT parity tolerance');
  }
  monetary(actual: unknown, expected: unknown, label: string, exact = false): void {
    assert(actual !== undefined && expected !== undefined, `Missing parity money ${label}`);
    const actualText = String(actual), expectedText = String(expected), actualValue = money(actualText);
    assert(actualValue.isFinite(), `CCT parity mismatch ${label}: ${actual} != ${expected}`);
    if (actualText === expectedText) { this.moneyChecks++; return; }
    const expectedValue = money(expectedText);
    assert(expectedValue.isFinite(), `CCT parity mismatch ${label}: ${actual} != ${expected}`);
    if (actualValue.eq(expectedValue)) { this.moneyChecks++; return; }
    const error = actualValue.minus(expectedValue).abs();
    assert(error.isFinite() && (exact ? error.isZero() : error.lte(this.toleranceValue)), `CCT parity mismatch ${label}: ${actual} != ${expected}`);
    if (error.gt(this.maximumError)) this.maximumError = error;
    this.moneyChecks++;
  }
  frame(actual: PortfolioPaperWalletObservation, expected: Record<string, any>): void {
    assert(actual.lastTime === expected.time, 'CCT parity frame timestamp');
    for (const [a, b] of Object.entries({ cash: 'cash', equity: 'equity', grossNotional: 'grossNotional', totalFees: 'fees', totalSlippage: 'slippage', fundingPnl: 'funding', realizedPnl: 'realized' })) this.monetary(actual[a as keyof typeof actual], expected[b], `frame.${a}`);
    for (const [a, b] of [['fillCount','fills'], ['rejectedCount','rejects'], ['rebalanceCount','rebalances']] as const) assert(actual[a] === expected[b], `CCT parity count ${a}`);
    assert(Object.keys(actual.positions).sort().join() === Object.keys(expected.positions).sort().join(), 'CCT parity inventory symbols');
    for (const [s, p] of Object.entries(actual.positions)) { this.monetary(p.quantity, expected.positions[s].quantity, `position.${s}.quantity`, true); this.monetary(p.averageEntry, expected.positions[s].averageEntry, `position.${s}.averageEntry`); }
    const day = actual.currentDay!, old = expected.currentDay;
    assert(Math.floor((day.startTime + ICT) / DAY) === old.day && day.riskLatched === old.latched && day.latchReason === old.reason, 'CCT parity ICT day/latch');
    for (const [a, b] of Object.entries({ anchorEquity: 'anchor', netPnl: 'net', worstNetPnl: 'worst', breachUsd: 'breach', endEquity: 'end' })) this.monetary(day[a as keyof typeof day], old[b], `day.${a}`);
    this.frames++;
  }
  event(actual: PortfolioPaperEvent, expected: Record<string, any>): void {
    assert(actual.time === expected.time && actual.kind === expected.kind && actual.symbol === (expected.symbol ?? undefined), `CCT parity event identity ${actual.time}:${actual.kind} != ${expected.time}:${expected.kind}`);
    if (actual.kind !== 'day_roll') assert(actual.reason === expected.reason, `CCT parity event reason ${actual.kind}`);
    const ignored = new Set(['time','kind','symbol','reason','latchReason','feasible','quantities','marks','references','projectedQuantities']);
    for (const [key, item] of Object.entries(expected)) {
      if (ignored.has(key)) continue;
      const actualKey = key === 'anchor' ? 'anchorEquity' : key;
      this.monetary((actual as any)[actualKey], item, `event.${actual.kind}.${key}`, key === 'quantity' || key === 'candidateQuantity');
    }
    if ('latchReason' in expected) assert(actual.latchReason === expected.latchReason, 'CCT parity latch reason');
    if ('feasible' in expected) assert(actual.feasible === expected.feasible, 'CCT parity projection feasible');
    for (const field of ['quantities','marks','references','projectedQuantities'] as const) if (expected[field]) {
      const values = actual[field] ?? {}; assert(Object.keys(values).sort().join() === Object.keys(expected[field]).sort().join(), `CCT parity ${field} keys`);
      for (const [s, item] of Object.entries(expected[field])) this.monetary(values[s], item, `event.${field}.${s}`, field === 'quantities' || field === 'projectedQuantities');
    }
    this.events++;
  }
  summary(actual: PortfolioPaperSummary, expected: Record<string, any>): void {
    for (const key of ['equity','netPnl','meanNetPerCalendarDay','totalFees','totalSlippage','fundingPnl','realizedPnl','worstDayNetPnl','maxDailyBreachUsd'] as const) this.monetary(actual[key], expected[key], `summary.${key}`);
    for (const key of ['calendarDays','fillCount','rejectedCount','rebalanceCount'] as const) assert(actual[key] === expected[key], `CCT parity summary count ${key}`);
  }
}

export async function runCctHistoricalPaperTestbed(options: { protocolPath: string; outputDir: string;
  onProgress?: (progress: { case: string; frames: number; totalFrames: number }) => void }): Promise<CctHistoricalPaperReport> {
  const protocolPath = resolve(options.protocolPath), root = dirname(protocolPath), outputDir = resolve(options.outputDir);
  const body = await readFile(protocolPath), protocol = JSON.parse(body.toString()) as CctReplayProtocol;
  const protocolSha256 = createHash('sha256').update(body).digest('hex');
  assert(protocol.status === 'REGISTERED_BEFORE_TS_REPLAY' && protocol.policyId === CCT_PAPER_POLICY.id && protocol.windowId in CCT_TESTBED_WINDOWS, 'Unregistered CCT protocol/policy/window');
  assert(JSON.stringify(protocol.commonConfig) === JSON.stringify(CCT_PAPER_POLICY) && JSON.stringify(protocol.cases) === JSON.stringify(CASES), 'CCT protocol config drift');
  const window = CCT_TESTBED_WINDOWS[protocol.windowId];
  const registered = new Map(protocol.inputs.map(input => [resolve(root, input.path), input.sha256]));
  assert(registered.size === protocol.inputs.length && registered.size > 0, 'Empty/duplicate CCT input registration');
  for (const [path, hash] of registered) assert(await digest(path) === hash, `Registered CCT input changed: ${path}`);
  const registeredPath = (path: string): string => { const absolute = resolve(root, path); assert(registered.has(absolute), `CCT dependency not registered: ${path}`); return absolute; };
  for (const module of ['paper-engine.ts','types.ts','policy-registry.ts','target-projection.ts','source-cct.ts','cct-types.ts','cct-historical-replay.ts']) registeredPath(join(__dirname, module));
  const reportPath = join(outputDir, 'report.json');
  if (await exists(reportPath)) {
    const manifest = JSON.parse(await readFile(join(outputDir, 'artifact-manifest.json'), 'utf8')) as Record<string, string>;
    assert(manifest['report.json'] === await digest(reportPath), 'CCT cached report hash mismatch');
    const cached = JSON.parse(await readFile(reportPath, 'utf8')) as CctHistoricalPaperReport;
    assert(cached.protocolSha256 === protocolSha256 && cached.policyId === protocol.policyId && cached.windowId === protocol.windowId, 'CCT cached report identity mismatch');
    return cached;
  }
  const shards: Array<{ manifest: MinuteManifest; directory: string }> = []; let nextStart = window.startTimeMs as number;
  for (const shard of protocol.data.minuteShards) {
    const path = registeredPath(shard.manifestPath), manifest = JSON.parse(await readFile(path, 'utf8')) as MinuteManifest;
    assert(manifest.startTimeMs === nextStart && manifest.endTimeMs <= window.endTimeMs && manifest.barIntervalMs === MINUTE && manifest.symbols.slice().sort().join() === [...CCT_SOURCE_SYMBOLS].sort().join(), 'CCT shard gap/overlap/universe');
    assert(manifest.mainFiles.length === 5 && new Set(manifest.mainFiles.map(f => f.symbol)).size === 5, 'CCT shard files must cover B5');
    for (const file of manifest.mainFiles) assert(registered.get(registeredPath(resolve(dirname(path), file.path))) === file.sha256 && file.rows === (manifest.endTimeMs - manifest.startTimeMs) / MINUTE, 'CCT minute manifest hash/rows mismatch');
    shards.push({ manifest, directory: dirname(path) }); nextStart = manifest.endTimeMs;
  }
  assert(nextStart === window.endTimeMs, 'CCT shards do not cover registered window');
  const targets = new Map<number, SourcePortfolioTargets>();
  assert(protocol.data.targetWeightMultiplier === '1' || protocol.data.targetWeightMultiplier === '1.5', 'Invalid CCT registered source scaling');
  for (const path of protocol.data.targetsPaths) for await (const row of cctJsonLines(registeredPath(path))) {
    const t = Number(row.executeAtMs); assert(t >= window.startTimeMs && t < window.endTimeMs && t % DAY === 0 && row.knownAtMs === t && row.labelTimeMs === t - DAY && !targets.has(t), 'CCT source row window/timing/duplicate');
    const decimalWeights = Object.fromEntries(Object.entries((row.decimalWeights ?? row.weights) as Record<string, Numeric>).map(([s, w]) => [s, money(w).mul(protocol.data.targetWeightMultiplier).toString()]));
    assert(Object.entries(decimalWeights).every(([s, w]) => CCT_SOURCE_SYMBOLS.includes(s as typeof CCT_SOURCE_SYMBOLS[number]) || money(w).isZero()), 'CCT source outside B5');
    targets.set(t, { ...row, weights: Object.fromEntries(Object.entries(decimalWeights).map(([s, w]) => [s, Number(w)])), decimalWeights,
      sourceId: `${CCT_SOURCE_REVISION}:${t}`, originalSourceId: row.originalSourceId ?? row.sourceId, strategy: 'cct-lc-b5-v1', metadata: row.metadata,
      knownAtMs: t, executeAtMs: t, labelTimeMs: t - DAY } as SourcePortfolioTargets);
  }
  assert(targets.size === window.calendarDays, 'CCT source must include every UTC daily row');
  const funding: CctMinuteFunding[] = [];
  for (const path of protocol.data.fundingPaths) { const rows = JSON.parse(await readFile(registeredPath(path), 'utf8')) as CctMinuteFunding[]; funding.push(...rows); }
  funding.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  assert(funding.length === window.calendarDays * 15 && new Set(funding.map(f => f.id)).size === funding.length && funding.every(f => f.time >= window.startTimeMs && f.time < window.endTimeMs && CCT_SOURCE_SYMBOLS.includes(f.symbol as typeof CCT_SOURCE_SYMBOLS[number]) && f.markPrice !== undefined && money(f.markPrice).gt(0)), 'CCT exact funding coverage/mark missing');
  const rawFilters = JSON.parse(await readFile(registeredPath(protocol.data.filtersPath), 'utf8')) as any;
  const filters: Record<string, SymbolFilter> = {};
  for (const s of CCT_SOURCE_SYMBOLS) {
    if (Array.isArray(rawFilters.symbols)) { const row = rawFilters.symbols.find((x: any) => x.symbol === s); assert(row, `Missing CCT filter ${s}`);
      const fs = Object.fromEntries(row.filters.map((f: any) => [f.filterType, f])) as Record<string, any>, lot = fs.MARKET_LOT_SIZE ?? fs.LOT_SIZE;
      filters[s] = { stepSize: lot.stepSize, minQty: lot.minQty, maxQty: lot.maxQty, minNotional: fs.MIN_NOTIONAL.notional };
    } else { assert(rawFilters[s], `Missing CCT filter ${s}`); filters[s] = rawFilters[s]; }
  }
  if (protocol.parityReferences) for (const ref of Object.values(protocol.parityReferences)) for (const path of Object.values(ref)) registeredPath(path);
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'execution-registration.json'), `${JSON.stringify({ status: 'STARTED_ONCE_REGISTERED_TS_PARITY', protocolPath, protocolSha256, policyId: protocol.policyId, windowId: protocol.windowId, createdUtc: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' });
  const engines = Object.fromEntries((['base','stress'] as const).map(name => [name, new PortfolioPaperEngine(buildCctPaperConfig(filters, CASES[name]))])) as Record<'base' | 'stress', PortfolioPaperEngine>;
  const runs = {} as Record<'base' | 'stress', { directory: string; frames: JsonLines; events: JsonLines; parity: CctRecordedParity; frameReference?: AsyncGenerator<Record<string, any>>; eventReference?: AsyncGenerator<Record<string, any>>; steps: number; eventsCount: number; peakGross: number; peakRatio: number; peakTracking: number; trackingSum: number }>;
  for (const name of ['base','stress'] as const) {
    const directory = join(outputDir, name); await mkdir(directory, { recursive: true });
    const reference = protocol.parityReferences?.[name];
    runs[name] = { directory, frames: new JsonLines(join(directory, 'frames.ndjson')), events: new JsonLines(join(directory, 'events.ndjson')),
      parity: new CctRecordedParity(protocol.monetaryToleranceUsd), ...(reference ? { frameReference: cctJsonLines(registeredPath(reference.framesPath)), eventReference: cctJsonLines(registeredPath(reference.eventsPath)) } : {}), steps: 0, eventsCount: 0, peakGross: 0, peakRatio: 0, peakTracking: 0, trackingSum: 0 };
  }
  let frameCount = 0, sourceCount = 0; const started = Date.now();
  try {
    for await (const frame of streamCctMinuteFrames(shards, funding)) {
      const target = targets.get(frame.openTimeMs); if (target) sourceCount++;
      for (const name of ['base','stress'] as const) {
        const run = runs[name], emitted: PortfolioPaperEvent[] = [];
        const latest = processCctMinuteFrame(engines[name], frame, { target, final: frame.endTimeMs === window.endTimeMs,
          onTransition: result => { run.steps++; emitted.push(...result.events); } });
        for (const event of emitted) {
          if (run.eventReference) { const old = await run.eventReference.next(); assert(!old.done, 'CCT emitted extra event'); run.parity.event(event, old.value); }
          await run.events.append(event); run.eventsCount++;
        }
        if (run.frameReference) { const old = await run.frameReference.next(); assert(!old.done, 'CCT emitted extra frame'); run.parity.frame(latest, old.value); }
        await run.frames.append({ time: latest.lastTime, cash: latest.cash, equity: latest.equity, grossNotional: latest.grossNotional,
          totalFees: latest.totalFees, totalSlippage: latest.totalSlippage, fundingPnl: latest.fundingPnl, realizedPnl: latest.realizedPnl,
          currentDay: latest.currentDay, positions: latest.positions, fillCount: latest.fillCount, rejectedCount: latest.rejectedCount,
          rebalanceCount: latest.rebalanceCount, decisionIntervalMs: MINUTE });
        run.peakGross = Math.max(run.peakGross, Number(latest.grossNotional));
        if (Number(latest.equity) > 0) run.peakRatio = Math.max(run.peakRatio, Number(latest.grossNotional) / Number(latest.equity));
        if (target) {
          const tracking = CCT_SOURCE_SYMBOLS.reduce((sum, s) => sum + Math.abs(Number(latest.positions[s]?.quantity ?? 0) * Number(frame.mark[s].open) / Number(latest.equity) - Number(target.decimalWeights?.[s] ?? target.weights[s])), 0);
          run.peakTracking = Math.max(run.peakTracking, tracking); run.trackingSum += tracking;
        }
      }
      frameCount++;
      if (frameCount % 1440 === 0) options.onProgress?.({ case: 'base+stress', frames: frameCount, totalFrames: window.calendarDays * 1440 });
    }
    assert(frameCount === window.calendarDays * 1440 && sourceCount === window.calendarDays, 'CCT replay incomplete');
    const cases = {} as Record<'base' | 'stress', CctHistoricalPaperCaseReport>;
    for (const name of ['base','stress'] as const) {
      const run = runs[name], snapshot = engines[name].snapshot(), summary = engines[name].summary();
      assert(!Object.keys(snapshot.positions).length && snapshot.lastTime === window.endTimeMs - 1 && summary.calendarDays === window.calendarDays && snapshot.days.length === window.calendarDays - 1, 'CCT wallet terminal state/denominator');
      if (run.frameReference) assert((await run.frameReference.next()).done, 'CCT missing recorded frame');
      if (run.eventReference) assert((await run.eventReference.next()).done, 'CCT missing recorded event');
      if (protocol.parityReferences) run.parity.summary(summary, JSON.parse(await readFile(registeredPath(protocol.parityReferences[name].summaryPath), 'utf8')));
      const days = [...snapshot.days, snapshot.currentDay!];
      const files = Object.fromEntries(['frames.ndjson','events.ndjson','checkpoint.json','days.json','report.json'].map(file => [file.split('.')[0], join(run.directory, file)]));
      const { filters: _filters, ...config } = buildCctPaperConfig(filters, CASES[name]);
      cases[name] = { summary, config, metrics: { frames: frameCount, engineSteps: run.steps, emittedEvents: run.eventsCount, sourceRebalances: sourceCount,
        fundingSettlements: funding.length, fundingMarkFallbacks: 0, dailyBudgetBreached: money(summary.maxDailyBreachUsd).gt(0), missingMidnightAnchors: days.filter(d => d.anchorQuality === 'missing_midnight').length,
        runtimeMs: Date.now() - started, peakGrossNotionalAtMinuteClose: String(run.peakGross), peakGrossEquityRatioAtMinuteClose: run.peakRatio, peakTrackingErrorWeight: run.peakTracking, meanTrackingErrorWeight: run.trackingSum / sourceCount },
        parity: { status: protocol.parityReferences ? 'PASS' : 'NOT_REQUESTED', frames: run.parity.frames, events: run.parity.events, moneyChecks: run.parity.moneyChecks, maximumMonetaryErrorUsd: run.parity.maximumError.toString(), monetaryToleranceUsd: protocol.monetaryToleranceUsd }, files };
      await run.frames.close(); await run.events.close();
      await writeFile(files.checkpoint, `${JSON.stringify(snapshot)}\n`, { flag: 'wx' });
      await writeFile(files.days, `${JSON.stringify(days, null, 2)}\n`, { flag: 'wx' });
      await writeFile(files.report, `${JSON.stringify(cases[name], null, 2)}\n`, { flag: 'wx' });
    }
    const report: CctHistoricalPaperReport = { status: 'COMPLETE_CCT_ACCELERATED_PAPER_TESTBED', policyId: protocol.policyId, windowId: protocol.windowId, createdUtc: new Date().toISOString(), protocolSha256,
      sourceRevision: CCT_SOURCE_REVISION, startTimeMs: window.startTimeMs, endTimeMs: window.endTimeMs, calendarDays: window.calendarDays, cases,
      data: { minuteShards: protocol.data.minuteShards, sourceRows: sourceCount, fundingEvents: funding.length, initialWalletsPerCase: 1, splitResets: 0, terminalCloseTimeMs: window.endTimeMs - 1 },
      limitations: ['Retrospective implementation parity over known historical windows; not prospective income evidence.', 'Exposure peak metrics sample minute closes; risk checks and recorded monetary parity run at every modeled transition.', 'Per-symbol1m adverse extrema form a synthetic envelope; observed breaches are retained, and no live10u guarantee is implied.', 'Actual funding timestamps and public settlement marks are required; no missing funding is replaced with zero.', 'Current recorded MARKET filters and uniform margin assumptions remain explicit execution model limitations.'] };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    const paths = ['report.json', 'execution-registration.json', ...Object.values(cases).flatMap(c => Object.values(c.files).map(path => path.slice(outputDir.length + 1)))];
    const artifacts: Record<string, string> = {};
    for (const path of paths) artifacts[path] = await digest(join(outputDir, path));
    await writeFile(join(outputDir, 'artifact-manifest.json'), `${JSON.stringify(artifacts, null, 2)}\n`, { flag: 'wx' });
    return report;
  } catch (error) { for (const run of Object.values(runs)) { run.frames.destroy(); run.events.destroy(); await run.frameReference?.return(undefined); await run.eventReference?.return(undefined); } throw error; }
}
