import type { LiveBroker, LiveRawRow } from './live-broker';
import type { LiveIntent } from './live-service';

const DAY = 86_400_000;
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'] as const;
type Lane = 'metadata' | 'orders' | 'history' | 'intents';
type Rows = LiveRawRow[];
export interface LiveBackgroundMetadata {
  /** Request start, so a slow response cannot make an old request appear fresh. */
  at: number; info: LiveRawRow; fees: Rows; setup: Rows; dual: boolean;
}
export interface LiveBackgroundOrders { at: number; regular: Rows; algo: Rows; }
export interface LiveBackgroundHistory {
  revision: number; startedAtMs: number; from: number; through: number; incomes: Rows; trades: Rows;
}
export interface LiveBackgroundIntents {
  revision: number; at: number;
  orders: Array<{ symbol: string; clientOrderId: string; order: LiveRawRow | null; error?: string }>;
}
export interface LiveBackgroundSnapshot {
  metadata: LiveBackgroundMetadata | null; orders: LiveBackgroundOrders | null;
  history: LiveBackgroundHistory | null; intents: LiveBackgroundIntents | null;
  pending: Record<Lane, boolean>; errors: Partial<Record<Lane, string>>;
}
export interface LiveBackgroundUpdate {
  startedAtMs: number; lastObservedAtMs: number; accountIdentity: string; intents: LiveIntent[];
  /** Last complete history batch applied to the durable wallet, rather than a fast account observation. */
  historyThroughMs?: number;
  urgentHistory?: boolean; forceSinceMs?: number;
}
const terminal = (status: string): boolean => ['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(status);
const timestamp = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid background observation timestamp');
  return n;
};
const object = (value: unknown): LiveRawRow => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid background observation');
  return value as LiveRawRow;
};
const array = (value: unknown): Rows => {
  if (!Array.isArray(value)) throw new Error('Invalid background observations');
  return value.map(object);
};
function failure(lane: Lane, error: unknown): string {
  // Do not retain arbitrary messages: transports may include signed URLs or private payloads.
  const code = (error as { binanceCode?: unknown })?.binanceCode;
  return `Authenticated background ${lane} unavailable${typeof code === 'number' && Number.isSafeInteger(code) ? ` (code ${code})` : ''}`;
}
async function together<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  // A rejected sibling must not release this lane while its other requests remain in flight.
  const settled = await Promise.allSettled(values);
  for (const result of settled) if (result.status === 'rejected') throw result.reason;
  return settled.map(result => (result as PromiseFulfilledResult<unknown>).value) as { -readonly [P in keyof T]: Awaited<T[P]> };
}
function unresolved(intent: LiveIntent): boolean {
  // Quantities are exact venue decimal strings; compare numerically without losing precision.
  const normalized = (value: string): string => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return value;
    return value.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  };
  return !terminal(intent.status) || normalized(intent.observedFillQty) !== normalized(intent.executedQty);
}

/**
 * Fetch-only auxiliary lanes. A slow ledger/metadata request never owns the live wallet lock.
 * The live service alone applies these observations and decides whether trading is authorized.
 */
export class LiveBackgroundSupport {
  private state: LiveBackgroundSnapshot = { metadata: null, orders: null, history: null, intents: null,
    pending: { metadata: false, orders: false, history: false, intents: false }, errors: {} };
  private attempts: Partial<Record<Lane, number>> = {};
  private forced: Partial<Record<Lane, number>> = {};
  private boundStart: number | undefined;
  private historyRevision = 0;
  private intentRevision = 0;

  constructor(private readonly broker: LiveBroker, private readonly now: () => number = Date.now) {}

  /** Detached rows prevent service sorting or callers mutating the fetcher's cache. */
  snapshot(): LiveBackgroundSnapshot { return structuredClone(this.state); }

  private due(lane: Lane, time: number, interval: number, forceSinceMs?: number): boolean {
    if (this.state.pending[lane]) return false;
    if (forceSinceMs !== undefined && (this.forced[lane] === undefined || this.forced[lane]! < forceSinceMs)) return true;
    const previous = this.attempts[lane];
    return previous === undefined || time < previous || time - previous >= interval;
  }

  private launch(lane: Lane, time: number, forceSinceMs: number | undefined, operation: () => Promise<void>): void {
    this.state.pending[lane] = true; this.attempts[lane] = time;
    if (forceSinceMs !== undefined) this.forced[lane] = forceSinceMs;
    void Promise.resolve().then(operation).then(() => { delete this.state.errors[lane]; }, error => {
      this.state.errors[lane] = failure(lane, error);
    }).finally(() => { this.state.pending[lane] = false; });
  }

  update(input: LiveBackgroundUpdate): void {
    const time = timestamp(this.now()), startedAtMs = timestamp(input.startedAtMs);
    const lastObservedAtMs = timestamp(input.lastObservedAtMs);
    if (input.accountIdentity !== this.broker.identity || lastObservedAtMs < startedAtMs
      || startedAtMs > time || lastObservedAtMs > time + 2_000) throw new Error('Background account/time identity mismatch');
    if (this.boundStart !== undefined && this.boundStart !== startedAtMs) throw new Error('Background wallet identity changed');
    this.boundStart = startedAtMs;
    const forceSinceMs = input.forceSinceMs === undefined ? undefined : timestamp(input.forceSinceMs);
    if (forceSinceMs !== undefined && forceSinceMs > time) throw new Error('Background force time is in the future');
    const historyThroughMs = input.historyThroughMs === undefined ? startedAtMs : timestamp(input.historyThroughMs);
    if (historyThroughMs < startedAtMs || historyThroughMs > time) throw new Error('Background history coverage time mismatch');
    // Capture primitives. Never retain a wallet or mutable intent supplied by the service.
    const pending = input.intents.filter(unresolved).map(intent => ({ symbol: intent.symbol, clientOrderId: intent.clientOrderId }));
    const from = Math.max(startedAtMs, historyThroughMs - DAY), through = time;
    if (!pending.length && !this.state.pending.intents) {
      // A history batch may prove a fill after its last order query failed. Once
      // no intents need querying, the obsolete failure must not persist forever.
      delete this.state.errors.intents;
      this.state.intents = null;
    }

    if (this.due('metadata', time, this.state.metadata && !this.state.errors.metadata ? 60_000 : 10_000, forceSinceMs)) this.launch('metadata', time, forceSinceMs, async () => {
      const [info, fees, setup, mode] = await together([this.broker.getExchangeInfo(),
        together(SYMBOLS.map(symbol => this.broker.getCommissionRate(symbol))),
        this.broker.getSymbolConfiguration(), this.broker.getPositionMode()]);
      if (typeof mode.dualSidePosition !== 'boolean') throw new Error('Unknown background position mode');
      this.state.metadata = structuredClone({ at: time, info: object(info), fees: array(fees), setup: array(setup), dual: mode.dualSidePosition });
    });
    if (this.due('orders', time, this.state.orders && !this.state.errors.orders ? 30_000 : 10_000, forceSinceMs)) this.launch('orders', time, forceSinceMs, async () => {
      const [regular, algo] = await together([this.broker.getOpenOrders(), this.broker.getOpenAlgoOrders()]);
      this.state.orders = structuredClone({ at: time, regular: array(regular), algo: array(algo) });
    });
    if (this.due('history', time, input.urgentHistory ? 10_000 : 30_000, forceSinceMs)) {
      this.launch('history', time, forceSinceMs, async () => {
        const [incomes, tradeGroups] = await together([this.income(from, through),
          together(SYMBOLS.map(symbol => this.trades(symbol, from, through)))]);
        this.state.history = structuredClone({ revision: ++this.historyRevision, startedAtMs, from, through,
          incomes, trades: tradeGroups.flat() });
      });
    }
    if (pending.length && this.due('intents', time, 2_000)) this.launch('intents', time, undefined, async () => {
      const results = await Promise.all(pending.map(async intent => {
        try {
          const order = object(await this.broker.queryOrder(intent.symbol, intent.clientOrderId));
          if (order.symbol !== intent.symbol || order.clientOrderId !== intent.clientOrderId) throw new Error('Background order identity mismatch');
          return { ...intent, order };
        } catch (error) {
          if ((error as { binanceCode?: unknown })?.binanceCode === -2013) return { ...intent, order: null };
          return { ...intent, order: null, error: failure('intents', error) };
        }
      }));
      this.state.intents = structuredClone({ revision: ++this.intentRevision, at: time, orders: results });
      if (results.some(result => 'error' in result)) throw new Error('Some intent queries failed');
    });
  }

  private async income(from: number, through: number): Promise<Rows> {
    const result: Rows = []; let requests = 0;
    // Bound catch-up requests to seven-day segments after a long outage.
    // The batch publishes only when every segment/page is complete.
    for (let start = from; start <= through; start += 7 * DAY) {
      const end = Math.min(through, start + 7 * DAY - 1);
      for (let page = 1; ; page++) {
        if (++requests > 100) throw new Error('Income coverage incomplete');
        const batch = array(await this.broker.getIncome({ startTime: start, endTime: end, limit: 1000, page }));
        for (const observation of batch) {
          const time = timestamp(observation.time);
          if (time < start || time > end) throw new Error('Income outside requested coverage');
        }
        result.push(...batch);
        if (batch.length < 1000) break;
      }
    }
    return result;
  }

  private async trades(symbol: string, from: number, through: number): Promise<Rows> {
    const result: Rows = []; let requests = 0;
    const complete = async (low: number, high: number): Promise<void> => {
      if (++requests > 1000) throw new Error('Trade coverage request limit reached');
      const batch = array(await this.broker.getUserTrades({ symbol, startTime: low, endTime: high, limit: 1000 }));
      for (const observation of batch) {
        const time = timestamp(observation.time);
        if (time < low || time > high || observation.symbol !== symbol) throw new Error('Trade outside requested coverage');
      }
      if (batch.length >= 1000) {
        if (low === high) throw new Error('Trade coverage saturated at one millisecond');
        const middle = Math.floor((low + high) / 2);
        await complete(low, middle); await complete(middle + 1, high); return;
      }
      result.push(...batch);
    };
    for (let start = from; start <= through; start += 7 * DAY) await complete(start, Math.min(through, start + 7 * DAY - 1));
    return result;
  }
}
