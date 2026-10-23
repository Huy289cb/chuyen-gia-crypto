/** Public market-data transport shared by paper polling and historical replay.
 * No account credentials, environment loading, order clients or strategy gates.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { SymbolFilter } from './types';

export const SOURCE_MOMENTUM_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT',
  'AVAXUSDT', 'LINKUSDT', 'LTCUSDT', 'DOTUSDT', 'TRXUSDT', 'UNIUSDT', 'ATOMUSDT',
  'ETCUSDT', 'XLMUSDT', 'BCHUSDT', 'FILUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT',
  'OPUSDT', 'INJUSDT', 'SUIUSDT', 'AAVEUSDT', 'ICPUSDT', 'ALGOUSDT', 'SANDUSDT',
  'GALAUSDT', 'GRTUSDT', '1000PEPEUSDT', 'WLDUSDT', 'SEIUSDT', 'TIAUSDT',
  'RUNEUSDT', 'ENAUSDT', 'ORDIUSDT', 'DYDXUSDT', 'JUPUSDT', 'ZECUSDT',
] as const;

export const FIVE_MINUTES_MS = 300_000;
export const DAY_MS = 86_400_000;
export const CCT_RUNTIME_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'] as const;
export const CCT_DAILY_SEED_SHA256 = '4a4ec0763a1080cec94c800be39fde402625ad073472626535f65b26a2b5601c';
const PUBLIC_BASE = 'https://fapi.binance.com';
const DEFAULT_DAILY_CSV = resolve(__dirname, '../../../docs/audits/futures-quick-win/source-replication-20261014T032757Z/data/prices.csv');

export interface SourceDailyRow {
  openTimeMs: number;
  closes: Record<string, number | null>;
}
export interface MarketBar {
  openTimeMs: number;
  closeTimeMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
}
export interface FundingSettlement {
  id: string;
  symbol: string;
  time: number;
  rate: string;
  markPrice?: string;
}
export interface HistoricalFrame {
  openTimeMs: number;
  endTimeMs: number;
  trade: Record<string, MarketBar>;
  mark: Record<string, MarketBar>;
  funding: FundingSettlement[];
}
interface PublicReceipt {
  url: string;
  httpStatus: number;
  receivedUtc: string;
  bytes: number;
  sha256: string;
  rawFile?: string;
}
export interface HistoricalDataManifest {
  status: 'PUBLIC_DATA_COMPLETE_NO_FINANCIAL_RUN';
  startTimeMs: number;
  endTimeMs: number;
  barIntervalMs: number;
  symbols: string[];
  barsPerSymbol: number;
  rawCandles: number;
  fundingEvents: number;
  fundingMarkFallbacks: number;
  dailyRows: number;
  currentFiltersSnapshotTimeMs: number;
  files: Array<{ path: string; bytes: number; sha256: string }>;
  requests: PublicReceipt[];
  limitations: string[];
}
type RawKline = [number, string, string, string, string, string, number, ...unknown[]];
type ExchangeInfo = { serverTime: number; symbols: Array<{ symbol: string; status: string; filters: Array<Record<string, string | number>> }> };

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function positivePrice(price: unknown): string {
  const value = String(price);
  ensure(Number.isFinite(Number(value)) && Number(value) > 0, `Invalid price ${value}`);
  return value;
}
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
async function publicJson<T>(path: string, receiptSink?: PublicReceipt[], rawDirectory?: string): Promise<T> {
  ensure(path.startsWith('/fapi/'), 'Only public futures endpoints are allowed');
  const url = `${PUBLIC_BASE}${path}`;
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': 'momentum-paper-public-data/1.0' } });
    if (response.ok) break;
    if (![429, 502, 503, 504].includes(response.status) || attempt === 2) {
      throw new Error(`Public request failed ${response.status}: ${url}`);
    }
    const waitMs = Math.min(10_000, Math.max(1_000, Number(response.headers.get('retry-after') ?? 2) * 1_000));
    await new Promise((done) => setTimeout(done, waitMs));
  }
  ensure(response?.ok, `No successful public response: ${url}`);
  const body = Buffer.from(await response.arrayBuffer());
  const receipt: PublicReceipt = { url, httpStatus: response.status, receivedUtc: new Date().toISOString(), bytes: body.length, sha256: sha256(body) };
  if (rawDirectory) {
    const name = `${receipt.sha256}.json.gz`;
    await writeFile(join(rawDirectory, name), gzipSync(body));
    receipt.rawFile = `raw/${name}`;
  }
  receiptSink?.push(receipt);
  return JSON.parse(body.toString('utf8')) as T;
}

export function parseDailyPriceCsv(body: string): SourceDailyRow[] {
  const lines = body.trim().split(/\r?\n/);
  const header = lines.shift()?.split(',') ?? [];
  ensure(header.length === 41 && header[0] === 'date', 'Expected original40-symbol daily CSV');
  ensure(header.slice(1).join(',') === SOURCE_MOMENTUM_SYMBOLS.join(','), 'Source universe/order mismatch');
  const rows = lines.map((line) => {
    const cells = line.split(',');
    ensure(cells.length === header.length, 'Malformed daily CSV row');
    const openTimeMs = Date.parse(`${cells[0]}T00:00:00.000Z`);
    ensure(Number.isSafeInteger(openTimeMs), 'Invalid daily date');
    const closes: Record<string, number | null> = {};
    header.slice(1).forEach((symbol, i) => { closes[symbol] = cells[i + 1] === '' ? null : Number(positivePrice(cells[i + 1])); });
    return { openTimeMs, closes };
  });
  ensure(rows.every((row, i) => i === 0 || row.openTimeMs - rows[i - 1].openTimeMs === DAY_MS), 'Daily input has duplicate/gap dates');
  return rows;
}

export function parseExchangeFilters(info: ExchangeInfo, symbols: readonly string[] = SOURCE_MOMENTUM_SYMBOLS): Record<string, SymbolFilter> {
  const output: Record<string, SymbolFilter> = {};
  for (const symbol of symbols) {
    const row = info.symbols.find((item) => item.symbol === symbol);
    ensure(row?.status === 'TRADING', `Missing/current inactive source contract ${symbol}`);
    const lot = row.filters.find((item) => item.filterType === 'LOT_SIZE');
    const market = row.filters.find((item) => item.filterType === 'MARKET_LOT_SIZE');
    const notional = row.filters.find((item) => item.filterType === 'MIN_NOTIONAL');
    ensure(lot && notional, `Missing quantity/notional filters ${symbol}`);
    output[symbol] = {
      stepSize: String(lot.stepSize), minQty: String(lot.minQty), maxQty: String(lot.maxQty),
      minNotional: String(notional.notional),
      ...(market ? { marketStepSize: String(market.stepSize), marketMinQty: String(market.minQty), marketMaxQty: String(market.maxQty) } : {}),
    };
  }
  return output;
}

function parseBars(raw: RawKline[], start: number, end: number): MarketBar[] {
  return raw.map((row) => {
    const openTimeMs = Number(row[0]);
    const closeTimeMs = Number(row[6]);
    ensure(Number.isSafeInteger(openTimeMs) && openTimeMs >= start && openTimeMs < end && openTimeMs % FIVE_MINUTES_MS === 0, 'Bad/misaligned market timestamp');
    ensure(closeTimeMs === openTimeMs + FIVE_MINUTES_MS - 1 && closeTimeMs < end, 'Unclosed/partial market candle');
    const [open, high, low, close] = row.slice(1, 5).map(positivePrice);
    ensure(Number(low) <= Math.min(Number(open), Number(close)) && Number(high) >= Math.max(Number(open), Number(close)), 'Invalid OHLC envelope');
    return { openTimeMs, closeTimeMs, open, high, low, close };
  });
}
async function fetchBars(symbol: string, endpoint: 'klines' | 'markPriceKlines', start: number, end: number, receipts: PublicReceipt[], rawDirectory: string): Promise<MarketBar[]> {
  const output: MarketBar[] = [];
  let cursor = start;
  while (cursor < end) {
    const raw = await publicJson<RawKline[]>(`/fapi/v1/${endpoint}?symbol=${symbol}&interval=5m&startTime=${cursor}&endTime=${end - 1}&limit=1000`, receipts, rawDirectory);
    ensure(Array.isArray(raw) && raw.length > 0, `Missing ${endpoint} data ${symbol} at ${cursor}`);
    const bars = parseBars(raw, start, end);
    ensure(bars[0].openTimeMs === cursor, `First candle gap ${symbol}`);
    ensure(bars.every((row, i) => i === 0 || row.openTimeMs - bars[i - 1].openTimeMs === FIVE_MINUTES_MS), `Interior candle gap ${symbol}`);
    output.push(...bars);
    cursor = bars[bars.length - 1].openTimeMs + FIVE_MINUTES_MS;
    await new Promise((done) => setTimeout(done, 250));
  }
  ensure(output.length === (end - start) / FIVE_MINUTES_MS, `Incomplete ${endpoint} ${symbol}`);
  return output;
}
async function fetchFunding(symbol: string, start: number, end: number, receipts?: PublicReceipt[], rawDirectory?: string, recent = false, requireCoverage = false): Promise<FundingSettlement[]> {
  const query = recent ? `symbol=${symbol}&limit=1000` : `symbol=${symbol}&startTime=${start}&endTime=${end - 1}&limit=1000`;
  const response = await publicJson<Array<{ symbol: string; fundingTime: number; fundingRate: string; markPrice?: string }>>(`/fapi/v1/fundingRate?${query}`, receipts, rawDirectory);
  if (requireCoverage) ensure(Array.isArray(response) && response.length > 0, `Missing held-inventory funding coverage ${symbol}; reconciliation required`);
  if (recent) ensure(response.length < 1000 || Number(response[0]?.fundingTime) <= start, `Recent funding page does not cover the requested cursor ${symbol}`);
  else ensure(response.length < 1000, `Funding pagination required ${symbol}`);
  // Current public server rejects some empty time-range queries; latest-page mode is
  // the same documented public endpoint, with explicit client bounds and coverage checks.
  const raw = recent ? response.filter(row => Number(row.fundingTime) >= start && Number(row.fundingTime) < end) : response;
  let previous = start - 1;
  return raw.map((row) => {
    const time = Number(row.fundingTime);
    ensure(row.symbol === symbol && Number.isSafeInteger(time) && time >= start && time < end && time > previous, `Invalid/duplicate funding settlement ${symbol}`);
    ensure(Number.isFinite(Number(row.fundingRate)), `Invalid funding rate ${symbol}`);
    previous = time;
    return { id: `binance-funding:${symbol}:${time}`, symbol, time, rate: String(row.fundingRate), ...(row.markPrice && Number(row.markPrice) > 0 ? { markPrice: positivePrice(row.markPrice) } : {}) };
  });
}

export async function collectHistoricalMarketData(options: {
  directory: string; startTimeMs: number; endTimeMs: number; dailyCsvPath?: string;
  onProgress?: (completedSymbols: number, totalSymbols: number) => void;
}): Promise<HistoricalDataManifest> {
  const directory = resolve(options.directory);
  ensure(!await exists(join(directory, 'manifest.json')), 'Finalized data already exists; refuse overwrite/refetch');
  ensure(options.endTimeMs <= Date.now() && options.startTimeMs % FIVE_MINUTES_MS === 0 && options.endTimeMs % FIVE_MINUTES_MS === 0, 'Invalid/unclosed collection window');
  ensure(options.endTimeMs > options.startTimeMs && options.endTimeMs - options.startTimeMs <= 14 * DAY_MS, 'Collection limited to registered14days');
  await mkdir(join(directory, 'raw'), { recursive: true });
  const requests: PublicReceipt[] = [];
  const info = await publicJson<ExchangeInfo>('/fapi/v1/exchangeInfo', requests, join(directory, 'raw'));
  parseExchangeFilters(info);
  await writeFile(join(directory, 'exchange-info.json'), `${JSON.stringify(info)}\n`);
  await copyFile(options.dailyCsvPath ?? DEFAULT_DAILY_CSV, join(directory, 'daily-source.csv'));
  const daily = parseDailyPriceCsv(await readFile(join(directory, 'daily-source.csv'), 'utf8'));
  let next = 0;
  let completed = 0;
  let fundingEvents = 0;
  let fundingMarkFallbacks = 0;
  const worker = async (): Promise<void> => {
    while (next < SOURCE_MOMENTUM_SYMBOLS.length) {
      const symbol = SOURCE_MOMENTUM_SYMBOLS[next++];
      const trade = await fetchBars(symbol, 'klines', options.startTimeMs, options.endTimeMs, requests, join(directory, 'raw'));
      const mark = await fetchBars(symbol, 'markPriceKlines', options.startTimeMs, options.endTimeMs, requests, join(directory, 'raw'));
      const funding = await fetchFunding(symbol, options.startTimeMs, options.endTimeMs, requests, join(directory, 'raw'));
      const rows = ['openTimeMs,tradeOpen,tradeHigh,tradeLow,tradeClose,markOpen,markHigh,markLow,markClose'];
      trade.forEach((bar, i) => {
        ensure(mark[i].openTimeMs === bar.openTimeMs, `Trade/mark date mismatch ${symbol}`);
        rows.push([bar.openTimeMs, bar.open, bar.high, bar.low, bar.close, mark[i].open, mark[i].high, mark[i].low, mark[i].close].join(','));
      });
      await writeFile(join(directory, `${symbol}-5m.csv`), `${rows.join('\n')}\n`);
      await writeFile(join(directory, `${symbol}-funding.json`), `${JSON.stringify(funding)}\n`);
      fundingEvents += funding.length;
      fundingMarkFallbacks += funding.filter((event) => !event.markPrice).length;
      completed += 1;
      options.onProgress?.(completed, SOURCE_MOMENTUM_SYMBOLS.length);
    }
  };
  await Promise.all([worker(), worker()]);
  const files = [];
  for (const name of ['exchange-info.json', 'daily-source.csv', ...SOURCE_MOMENTUM_SYMBOLS.flatMap((symbol) => [`${symbol}-5m.csv`, `${symbol}-funding.json`])]) {
    const body = await readFile(join(directory, name));
    files.push({ path: name, bytes: body.length, sha256: sha256(body) });
  }
  const manifest: HistoricalDataManifest = {
    status: 'PUBLIC_DATA_COMPLETE_NO_FINANCIAL_RUN', startTimeMs: options.startTimeMs, endTimeMs: options.endTimeMs,
    barIntervalMs: FIVE_MINUTES_MS, symbols: [...SOURCE_MOMENTUM_SYMBOLS], barsPerSymbol: (options.endTimeMs - options.startTimeMs) / FIVE_MINUTES_MS,
    rawCandles: 2 * SOURCE_MOMENTUM_SYMBOLS.length * (options.endTimeMs - options.startTimeMs) / FIVE_MINUTES_MS,
    fundingEvents, fundingMarkFallbacks, dailyRows: daily.length, currentFiltersSnapshotTimeMs: Number(info.serverTime), files, requests,
    limitations: ['5m adverse portfolio envelope combines separate symbol extremes; not synchronized intrabar ticks or continuous daily-limit assurance.',
      'Current exchange filters applied retrospectively; historical filter/margin tiers not verified.',
      'Research taker fees and slippage assumptions; no private account commission verification or live fills.',
      'Maintenance margin is supplied research assumption; venue tier liquidation/ADL not independently modeled.',
      'Funding uses actual public settlement timestamps/rates/markPrice when present; missing markPrice needs explicitly reported replay fallback.'],
  };
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function loadHistoricalMarketData(directory: string): Promise<{
  directory: string; manifest: HistoricalDataManifest; filters: Record<string, SymbolFilter>; dailyRows: SourceDailyRow[];
}> {
  const absolute = resolve(directory);
  const manifest = JSON.parse(await readFile(join(absolute, 'manifest.json'), 'utf8')) as HistoricalDataManifest;
  ensure(manifest.status === 'PUBLIC_DATA_COMPLETE_NO_FINANCIAL_RUN' && manifest.symbols.join(',') === SOURCE_MOMENTUM_SYMBOLS.join(','), 'Unrecognized dataset/universe');
  for (const file of manifest.files) {
    const body = await readFile(join(absolute, file.path));
    ensure(body.length === file.bytes && sha256(body) === file.sha256, `Data hash mismatch: ${file.path}`);
  }
  const rawVerified = new Set<string>();
  for (const receipt of manifest.requests) {
    ensure(receipt.rawFile && /^raw\/[a-f0-9]{64}\.json\.gz$/.test(receipt.rawFile), 'Missing/invalid raw public receipt path');
    if (rawVerified.has(receipt.rawFile)) continue;
    const body = gunzipSync(await readFile(join(absolute, receipt.rawFile)));
    ensure(body.length === receipt.bytes && sha256(body) === receipt.sha256, `Raw receipt hash mismatch: ${receipt.rawFile}`);
    rawVerified.add(receipt.rawFile);
  }
  return { directory: absolute, manifest, filters: parseExchangeFilters(JSON.parse(await readFile(join(absolute, 'exchange-info.json'), 'utf8')) as ExchangeInfo), dailyRows: parseDailyPriceCsv(await readFile(join(absolute, 'daily-source.csv'), 'utf8')) };
}

async function* symbolBars(path: string): AsyncGenerator<{ trade: MarketBar; mark: MarketBar }> {
  const source = createReadStream(path, { encoding: 'utf8', highWaterMark: 16_384 });
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  let first = true;
  try {
    for await (const line of lines) {
      if (first) { first = false; continue; }
      if (!line) continue;
      const fields = line.split(',');
      ensure(fields.length === 9, 'Malformed historical bar CSV');
      const openTimeMs = Number(fields[0]);
      const base = { openTimeMs, closeTimeMs: openTimeMs + FIVE_MINUTES_MS - 1 };
      yield { trade: { ...base, open: fields[1], high: fields[2], low: fields[3], close: fields[4] }, mark: { ...base, open: fields[5], high: fields[6], low: fields[7], close: fields[8] } };
    }
  } finally { lines.close(); source.destroy(); }
}

export async function* streamHistoricalFrames(dataset: Awaited<ReturnType<typeof loadHistoricalMarketData>>): AsyncGenerator<HistoricalFrame> {
  const iterators = SOURCE_MOMENTUM_SYMBOLS.map((symbol) => symbolBars(join(dataset.directory, `${symbol}-5m.csv`)));
  const funding = (await Promise.all(SOURCE_MOMENTUM_SYMBOLS.map(async (symbol) => JSON.parse(await readFile(join(dataset.directory, `${symbol}-funding.json`), 'utf8')) as FundingSettlement[]))).flat().sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  let fundingIndex = 0;
  try {
    for (let time = dataset.manifest.startTimeMs; time < dataset.manifest.endTimeMs; time += FIVE_MINUTES_MS) {
      const rows = await Promise.all(iterators.map((iterator) => iterator.next()));
      const trade: Record<string, MarketBar> = {};
      const mark: Record<string, MarketBar> = {};
      rows.forEach((row, i) => {
        ensure(!row.done && row.value.trade.openTimeMs === time, `Missing/misaligned historical frame ${time}`);
        trade[SOURCE_MOMENTUM_SYMBOLS[i]] = row.value.trade;
        mark[SOURCE_MOMENTUM_SYMBOLS[i]] = row.value.mark;
      });
      const settlements: FundingSettlement[] = [];
      while (fundingIndex < funding.length && funding[fundingIndex].time < time + FIVE_MINUTES_MS) {
        ensure(funding[fundingIndex].time >= time, 'Out-of-order funding event');
        settlements.push(funding[fundingIndex++]);
      }
      yield { openTimeMs: time, endTimeMs: time + FIVE_MINUTES_MS, trade, mark, funding: settlements };
    }
    ensure((await Promise.all(iterators.map((iterator) => iterator.next()))).every((row) => row.done), 'Extra market bars outside window');
    ensure(fundingIndex === funding.length, 'Unprocessed funding outside window');
  } finally { await Promise.all(iterators.map((iterator) => iterator.return(undefined))); }
}

let dailyCache: { day: number; path: string; rows: SourceDailyRow[] } | undefined;
let filterCache: { time: number; filters: Record<string, SymbolFilter> } | undefined;
export async function loadCurrentMarket(options: { dailyCsvPath?: string; fundingAfterMs?: number; nowMs?: number; fundingSymbols?: readonly string[] } = {}): Promise<{
  time: number; marks: Record<string, string>; tradePrices: Record<string, string>; filters: Record<string, SymbolFilter>;
  closedDailyRows: SourceDailyRow[]; fundingAvailable: FundingSettlement[]; provenance: Record<string, unknown>;
}> {
  const now = options.nowMs ?? Date.now();
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  const csvPath = options.dailyCsvPath ?? DEFAULT_DAILY_CSV;
  const receipts: PublicReceipt[] = [];
  if (!filterCache || now - filterCache.time > 300_000) {
    const info = await publicJson<ExchangeInfo>('/fapi/v1/exchangeInfo', receipts);
    filterCache = { time: now, filters: parseExchangeFilters(info) };
  }
  if (!dailyCache || dailyCache.day !== day || dailyCache.path !== csvPath) {
    const initial = parseDailyPriceCsv(await readFile(csvPath, 'utf8'));
    const merged = new Map(initial.map((row) => [row.openTimeMs, { openTimeMs: row.openTimeMs, closes: { ...row.closes } }]));
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < SOURCE_MOMENTUM_SYMBOLS.length) {
        const symbol = SOURCE_MOMENTUM_SYMBOLS[cursor++];
        const raw = await publicJson<RawKline[]>(`/fapi/v1/klines?symbol=${symbol}&interval=1d&endTime=${day - 1}&limit=64`, receipts);
        for (const row of raw) {
          ensure(Number(row[0]) % DAY_MS === 0 && Number(row[6]) === Number(row[0]) + DAY_MS - 1 && Number(row[6]) < day, 'Unclosed/misaligned live daily candle');
          const found = merged.get(Number(row[0])) ?? { openTimeMs: Number(row[0]), closes: Object.fromEntries(SOURCE_MOMENTUM_SYMBOLS.map((item) => [item, null])) };
          found.closes[symbol] = Number(positivePrice(row[4]));
          merged.set(Number(row[0]), found);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    dailyCache = { day, path: csvPath, rows: [...merged.values()].filter((row) => row.openTimeMs < day).sort((a, b) => a.openTimeMs - b.openTimeMs) };
  }
  const [premium, ticker] = await Promise.all([
    publicJson<Array<{ symbol: string; markPrice: string; time: number }>>('/fapi/v1/premiumIndex', receipts),
    publicJson<Array<{ symbol: string; price: string; time: number }>>('/fapi/v1/ticker/price', receipts),
  ]);
  const marks: Record<string, string> = {};
  const tradePrices: Record<string, string> = {};
  for (const symbol of SOURCE_MOMENTUM_SYMBOLS) {
    marks[symbol] = positivePrice(premium.find((row) => row.symbol === symbol)?.markPrice);
    tradePrices[symbol] = positivePrice(ticker.find((row) => row.symbol === symbol)?.price);
  }
  const fundingThroughMs = Date.now();
  const after = options.fundingAfterMs ?? fundingThroughMs;
  ensure(Number.isSafeInteger(after) && after <= fundingThroughMs && fundingThroughMs - after <= 14 * DAY_MS, 'Public funding refresh requires bounded14-day cursor');
  const fundingAvailable: FundingSettlement[] = [];
  const fundingSymbols = options.fundingSymbols ?? SOURCE_MOMENTUM_SYMBOLS;
  ensure(new Set(fundingSymbols).size === fundingSymbols.length && fundingSymbols.every(symbol => (SOURCE_MOMENTUM_SYMBOLS as readonly string[]).includes(symbol)), 'Invalid funding query universe');
  if (after < fundingThroughMs && fundingSymbols.length) {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < fundingSymbols.length) {
        const symbol = fundingSymbols[cursor++];
        fundingAvailable.push(...await fetchFunding(symbol, after + 1, fundingThroughMs + 1, receipts, undefined, true));
      }
    };
    await Promise.all([worker(), worker()]);
  }
  const observedAtMs = Date.now();
  return { time: observedAtMs, marks, tradePrices, filters: filterCache.filters, closedDailyRows: dailyCache.rows,
    fundingAvailable: fundingAvailable.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)),
    provenance: { publicOnly: true, requests: receipts, filterSnapshotTimeMs: filterCache.time, dailyClosedThroughMs: day,
      quoteObservationUtc: new Date(observedAtMs).toISOString(), quoteObservedAtMs: observedAtMs,
      fundingAfterMs: after, fundingThroughMs, fundingSymbols: [...fundingSymbols], feeAndMarginAreResearchAssumptions: true } };
}

/** Exact ICT anchor from historical/current1m mark candle OPEN, never its close. */
export async function loadBoundaryMarks(timeMs: number, symbols: readonly string[] = SOURCE_MOMENTUM_SYMBOLS): Promise<{
  time: number; marks: Record<string, string>; provenance: Record<string, unknown>;
}> {
  ensure(Number.isSafeInteger(timeMs) && (timeMs + 7 * 3_600_000) % DAY_MS === 0 && timeMs <= Date.now(), 'Boundary must be an observed ICT midnight');
  const marks: Record<string, string> = {};
  const requests: PublicReceipt[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      const raw = await publicJson<RawKline[]>(`/fapi/v1/markPriceKlines?symbol=${symbol}&interval=1m&startTime=${timeMs}&endTime=${timeMs + 59_999}&limit=1`, requests);
      ensure(raw.length === 1 && Number(raw[0][0]) === timeMs, `No exact ICT boundary mark ${symbol}`);
      marks[symbol] = positivePrice(raw[0][1]);
    }
  };
  await Promise.all([worker(), worker()]);
  return { time: timeMs, marks, provenance: { publicOnly: true, requests, observedAtMs: Date.now(),
    field: '1m_mark_candle_open', partialCandleCloseUsed: false, exactSynchronizedVenueTickProof: false } };
}

export interface CctSourceBridgeCheckpoint {
  revision: 'cct-full-daily-seed-v1';
  seedSha256: string;
  seedFirstOpenMs: number;
  seedLastOpenMs: number;
  closedThroughMs: number;
  appendedRows: SourceDailyRow[];
}

/** Immutable full seed plus append-only public closed candles. Persist this cursor WITH the wallet. */
export async function loadCctCurrentMarket(options: {
  dailyCsvPath?: string; sourceBridge?: CctSourceBridgeCheckpoint;
  fundingAfterMs?: number; fundingSymbols?: readonly string[]; nowMs?: number;
} = {}): Promise<{
  time: number; marks: Record<string, string>; tradePrices: Record<string, string>;
  filters: Record<string, SymbolFilter>; closedDailyRows: SourceDailyRow[];
  fundingAvailable: FundingSettlement[]; sourceBridge: CctSourceBridgeCheckpoint; provenance: Record<string, unknown>;
}> {
  const now = options.nowMs ?? Date.now();
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  const seedBody = await readFile(options.dailyCsvPath ?? DEFAULT_DAILY_CSV);
  ensure(sha256(seedBody) === CCT_DAILY_SEED_SHA256, 'CCT full-history daily seed hash mismatch; a new seed needs a versioned policy');
  const seed = parseDailyPriceCsv(seedBody.toString('utf8'));
  ensure(seed.length >= 361 && seed[seed.length - 1].openTimeMs < day, 'CCT requires the full original closed-day warmup seed');
  const first = seed[0].openTimeMs, last = seed[seed.length - 1].openTimeMs;
  const prior = options.sourceBridge;
  if (prior) {
    ensure(prior.revision === 'cct-full-daily-seed-v1' && prior.seedSha256 === CCT_DAILY_SEED_SHA256
      && prior.seedFirstOpenMs === first && prior.seedLastOpenMs === last, 'CCT source checkpoint/seed mismatch; refuse reseeding');
    ensure(Array.isArray(prior.appendedRows) && prior.closedThroughMs === last + (prior.appendedRows.length + 1) * DAY_MS,
      'CCT source checkpoint cursor mismatch');
  }
  const appended = (prior?.appendedRows ?? []).map(row => ({ openTimeMs: row.openTimeMs, closes: { ...row.closes } }));
  for (let i = 0; i < appended.length; i++) {
    ensure(appended[i].openTimeMs === last + (i + 1) * DAY_MS && appended[i].openTimeMs < day,
      'CCT source checkpoint has a gap, duplicate or future day');
    for (const symbol of CCT_RUNTIME_SYMBOLS) positivePrice(appended[i].closes[symbol]);
  }
  const fetchStart = last + (appended.length + 1) * DAY_MS;
  const requests: PublicReceipt[] = [];
  const newRows = new Map<number, SourceDailyRow>();
  // Every missing closed day is fetched, even after a long outage. No partial/tail-only reseed.
  for (const symbol of CCT_RUNTIME_SYMBOLS) {
    let cursor = fetchStart;
    while (cursor < day) {
      const raw = await publicJson<RawKline[]>(`/fapi/v1/klines?symbol=${symbol}&interval=1d&startTime=${cursor}&endTime=${day - 1}&limit=1000`, requests);
      ensure(Array.isArray(raw) && raw.length > 0, `CCT daily bridge missing ${symbol} at ${cursor}`);
      for (const row of raw) {
        const time = Number(row[0]);
        ensure(time === cursor && Number(row[6]) === time + DAY_MS - 1 && time < day, `CCT daily bridge gap/partial candle ${symbol}`);
        const found = newRows.get(time) ?? { openTimeMs: time, closes: Object.fromEntries(SOURCE_MOMENTUM_SYMBOLS.map(item => [item, null])) };
        found.closes[symbol] = Number(positivePrice(row[4])); newRows.set(time, found); cursor += DAY_MS;
      }
    }
  }
  const freshRows = [...newRows.values()].sort((a, b) => a.openTimeMs - b.openTimeMs);
  for (const row of freshRows) for (const symbol of CCT_RUNTIME_SYMBOLS) positivePrice(row.closes[symbol]);
  appended.push(...freshRows);
  const closedDailyRows = [...seed, ...appended];
  ensure(closedDailyRows[closedDailyRows.length - 1].openTimeMs === day - DAY_MS, 'CCT daily source has not reached the latest closed UTC day');
  const sourceBridge: CctSourceBridgeCheckpoint = { revision: 'cct-full-daily-seed-v1', seedSha256: CCT_DAILY_SEED_SHA256,
    seedFirstOpenMs: first, seedLastOpenMs: last, closedThroughMs: day, appendedRows: appended };
  const [info, premium, ticker] = await Promise.all([
    publicJson<ExchangeInfo>('/fapi/v1/exchangeInfo', requests),
    publicJson<Array<{ symbol: string; markPrice: string; time: number }>>('/fapi/v1/premiumIndex', requests),
    publicJson<Array<{ symbol: string; price: string; time: number }>>('/fapi/v1/ticker/price', requests),
  ]);
  const marks: Record<string, string> = {}, tradePrices: Record<string, string> = {};
  const quoteTimes: Record<string, { markTimeMs: number; tradeTimeMs: number }> = {};
  const quoteObservedAt = options.nowMs ?? Date.now();
  for (const symbol of CCT_RUNTIME_SYMBOLS) {
    const mark = premium.find(row => row.symbol === symbol), trade = ticker.find(row => row.symbol === symbol);
    marks[symbol] = positivePrice(mark?.markPrice); tradePrices[symbol] = positivePrice(trade?.price);
    const times = [Number(mark?.time), Number(trade?.time)];
    ensure(times.every(time => Number.isSafeInteger(time) && quoteObservedAt - time <= 30_000 && time - quoteObservedAt <= 5_000),
      `CCT stale/missing venue quote timestamp ${symbol}; entries are blocked`);
    quoteTimes[symbol] = { markTimeMs: times[0], tradeTimeMs: times[1] };
  }
  const fundingThroughMs = options.nowMs ?? Date.now(), after = options.fundingAfterMs ?? fundingThroughMs;
  ensure(Number.isSafeInteger(after) && after <= fundingThroughMs && fundingThroughMs - after <= 14 * DAY_MS, 'CCT funding cursor needs bounded historical reconciliation');
  const held = options.fundingSymbols ?? [];
  ensure(new Set(held).size === held.length && held.every(symbol => (CCT_RUNTIME_SYMBOLS as readonly string[]).includes(symbol)), 'Invalid CCT held funding universe');
  const fundingAvailable: FundingSettlement[] = [];
  if (after < fundingThroughMs) for (const symbol of held) {
    const settlements = await fetchFunding(symbol, after + 1, fundingThroughMs + 1, requests, undefined, true, true);
    ensure(settlements.every(item => item.markPrice), `Missing exact held-inventory funding mark ${symbol}; reconciliation required`);
    fundingAvailable.push(...settlements);
  }
  const time = options.nowMs ?? Date.now();
  ensure(Object.values(quoteTimes).every(item => time - item.markTimeMs <= 30_000 && time - item.tradeTimeMs <= 30_000),
    'CCT quotes became stale during funding collection; entries are blocked');
  return { time, marks, tradePrices, filters: parseExchangeFilters(info, CCT_RUNTIME_SYMBOLS), closedDailyRows,
    fundingAvailable: fundingAvailable.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)), sourceBridge,
    provenance: { publicOnly: true, requests, quoteTimes, quoteObservedAtMs: time, quoteMaxAgeMs: 30_000,
      sourceSeedSha256: CCT_DAILY_SEED_SHA256, sourceWarmupRows: seed.length, sourceClosedThroughMs: day,
      sourceGapFilledDays: freshRows.length, fundingAfterMs: after, fundingThroughMs, fundingSymbols: [...held],
      fundingMarkFallbacks: 0, feeAndMarginAreResearchAssumptions: true } };
}
