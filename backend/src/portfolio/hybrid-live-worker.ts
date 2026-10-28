import dotenv from 'dotenv';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {
  HYBRID_LIVE,
  HYBRID_SYMBOLS,
  breachedDailyLoss,
  gridTakeProfitIndexes,
  momentumStops,
  nextGridBuy,
  quantityForNotional,
  selectMomentum,
  type GridLeg,
  type HybridBook,
  type MomentumLeg,
} from './hybrid-live-plan';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

type LiveBroker = import('./live-broker').LiveBroker;

const DAY = 86_400_000;
const STATE_PATH = path.resolve(__dirname, '../../data/hybrid-live/state.json');
const PUBLIC_KLINES = 'https://fapi.binance.com/fapi/v1/klines';

interface LiveState extends HybridBook {
  schema: 'hybrid-live-v1';
  dayUtc: number;
  dayAnchorEquity: number;
  lastDecisionUtc: number;
  orders: string[];
}

function emptyState(equity: number, utc: number): LiveState {
  return {
    schema: 'hybrid-live-v1', momentum: [], grid: [], daysSinceRebalance: HYBRID_LIVE.momentumRebalanceDays,
    dayUtc: utc, dayAnchorEquity: equity, lastDecisionUtc: 0, orders: [],
  };
}

async function readState(equity: number, utc: number): Promise<LiveState> {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, 'utf8')) as LiveState;
    if (parsed.schema !== 'hybrid-live-v1') return emptyState(equity, utc);
    return parsed;
  } catch {
    return emptyState(equity, utc);
  }
}

async function writeState(state: LiveState): Promise<void> {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temporary = `${STATE_PATH}.tmp`;
  await writeFile(temporary, JSON.stringify(state));
  await rename(temporary, STATE_PATH);
}

async function closedCloses(symbol: string): Promise<number[]> {
  const response = await fetch(`${PUBLIC_KLINES}?symbol=${symbol}&interval=1d&limit=20`);
  if (!response.ok) throw new Error(`Daily candles failed for ${symbol}`);
  const rows = await response.json() as [number, string, string, string, string, string, number, ...unknown[]][];
  const today = Math.floor(Date.now() / DAY) * DAY;
  return rows.filter((row) => Number(row[6]) < today).map((row) => Number(row[4])).filter((price) => price > 0);
}

async function loadCloses(): Promise<Record<string, number[]>> {
  const closes: Record<string, number[]> = {};
  for (let index = 0; index < HYBRID_SYMBOLS.length; index += 4) {
    const batch = HYBRID_SYMBOLS.slice(index, index + 4);
    const rows = await Promise.all(batch.map(async (symbol) => [symbol, await closedCloses(symbol)] as const));
    for (const [symbol, series] of rows) closes[symbol] = series;
  }
  return closes;
}

function equityOf(account: { totalMarginBalance: string }): number {
  return Number(account.totalMarginBalance);
}

function clientId(utc: number, symbol: string, action: 'mbuy' | 'msell' | 'gbuy' | 'gsell' | 'flat'): string {
  const day = new Date(utc).toISOString().slice(0, 10).replace(/-/g, '');
  return `hyb-${day}-${symbol}-${action}`.slice(0, 36);
}

async function alreadySent(broker: LiveBroker, symbol: string, id: string, state: LiveState): Promise<boolean> {
  if (state.orders.includes(id)) return true;
  try {
    const order = await broker.queryOrder(symbol, id);
    return Number(order.executedQty) > 0 || order.status === 'NEW' || order.status === 'PARTIALLY_FILLED';
  } catch (error) {
    const code = typeof error === 'object' && error && 'binanceCode' in error ? Number((error as { binanceCode?: number }).binanceCode) : undefined;
    if (code === -2013 || code === -2011) return false;
    throw error;
  }
}

async function main(): Promise<void> {
  const { createDefaultLiveBroker } = await import('./live-broker');
  const broker = createDefaultLiveBroker({ retryReads: false, requestTimeoutMs: 15_000 });
  const mode = await broker.getPositionMode();
  const positionSide = mode.dualSidePosition ? 'LONG' : 'BOTH';
  let busy = false;

  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const account = await broker.getAccount();
      if (account.canTrade === false) throw new Error('Exchange account cannot trade');
      const equity = equityOf(account);
      const utc = Math.floor(Date.now() / DAY) * DAY;
      const state = await readState(equity, utc);
      if (state.dayUtc !== utc) {
        state.dayUtc = utc;
        state.dayAnchorEquity = equity;
      }
      const dayPnl = equity - state.dayAnchorEquity;
      const positions = await broker.getPositions();
      const held = new Map(positions.filter((position) => Number(position.positionAmt) !== 0).map((position) => [position.symbol, Number(position.positionAmt)]));
      const marks = Object.fromEntries((await broker.getMarkPrices()).map((mark) => [mark.symbol, Number(mark.markPrice)]));

      const flatten = async (symbol: string, qty: number, action: 'msell' | 'gsell' | 'flat'): Promise<void> => {
        if (!(qty > 0)) return;
        const id = clientId(utc, symbol, action);
        if (await alreadySent(broker, symbol, id, state)) return;
        await broker.submitMarketOrder({
          symbol, side: 'SELL', quantity: qty.toString(), clientOrderId: id, positionSide,
          ...(positionSide === 'BOTH' ? { reduceOnly: true } : {}),
        });
        state.orders.push(id);
      };

      if (breachedDailyLoss(dayPnl)) {
        for (const [symbol, amount] of held) await flatten(symbol, Math.abs(amount), 'flat');
        state.momentum = [];
        state.grid = [];
        await writeState(state);
        console.log(JSON.stringify({ event: 'hybrid_daily_loss_flat', dayPnl, equity }));
        return;
      }

      for (const symbol of momentumStops(state, marks)) {
        const leg = state.momentum.find((item) => item.symbol === symbol);
        if (!leg) continue;
        await flatten(symbol, leg.qty, 'msell');
        state.momentum = state.momentum.filter((item) => item.symbol !== symbol);
      }
      const tpIndexes = new Set(gridTakeProfitIndexes(state, marks.BTCUSDT ?? 0));
      if (tpIndexes.size) {
        const qty = state.grid.filter((_, index) => tpIndexes.has(index)).reduce((sum, leg) => sum + leg.qty, 0);
        await flatten('BTCUSDT', qty, 'gsell');
        state.grid = state.grid.filter((_, index) => !tpIndexes.has(index));
      }

      if (state.lastDecisionUtc !== utc) {
        const closes = await loadCloses();
        state.daysSinceRebalance += 1;
        if (state.daysSinceRebalance >= HYBRID_LIVE.momentumRebalanceDays) {
          for (const leg of state.momentum) await flatten(leg.symbol, leg.qty, 'msell');
          state.momentum = [];
          state.daysSinceRebalance = 0;
          const info = await broker.getExchangeInfo();
          const opened: MomentumLeg[] = [];
          for (const symbol of selectMomentum(closes)) {
            const contract = info.symbols.find((item) => item.symbol === symbol);
            const filters = contract?.filters ?? [];
            const lot = filters.find((filter) => filter.filterType === 'LOT_SIZE');
            const min = filters.find((filter) => filter.filterType === 'MIN_NOTIONAL' || filter.filterType === 'NOTIONAL');
            const price = closes[symbol]?.at(-1) ?? 0;
            const quantity = lot && min ? quantityForNotional(HYBRID_LIVE.momentumNotional, price, String(lot.stepSize), String(lot.minQty), String(min.notional ?? min.minNotional)) : null;
            if (!quantity) continue;
            await broker.setLeverage(symbol, HYBRID_LIVE.leverage);
            const id = clientId(utc, symbol, 'mbuy');
            if (await alreadySent(broker, symbol, id, state)) continue;
            await broker.submitMarketOrder({ symbol, side: 'BUY', quantity, clientOrderId: id, positionSide });
            state.orders.push(id);
            opened.push({ symbol, entry: price, qty: Number(quantity) });
          }
          state.momentum = opened;
        }
        const gridBuy = nextGridBuy(state, closes.BTCUSDT ?? []);
        if (gridBuy) {
          const info = await broker.getExchangeInfo();
          const contract = info.symbols.find((item) => item.symbol === 'BTCUSDT');
          const filters = contract?.filters ?? [];
          const lot = filters.find((filter) => filter.filterType === 'LOT_SIZE');
          const min = filters.find((filter) => filter.filterType === 'MIN_NOTIONAL' || filter.filterType === 'NOTIONAL');
          const price = closes.BTCUSDT?.at(-1) ?? 0;
          const quantity = lot && min ? quantityForNotional(gridBuy.notional, price, String(lot.stepSize), String(lot.minQty), String(min.notional ?? min.minNotional)) : null;
          if (quantity) {
            await broker.setLeverage('BTCUSDT', HYBRID_LIVE.leverage);
            const id = clientId(utc, 'BTCUSDT', 'gbuy');
            if (!(await alreadySent(broker, 'BTCUSDT', id, state))) {
              await broker.submitMarketOrder({ symbol: 'BTCUSDT', side: 'BUY', quantity, clientOrderId: id, positionSide });
              state.orders.push(id);
              const leg: GridLeg = { entry: price, qty: Number(quantity), tp: price * (1 + HYBRID_LIVE.gridTakeProfit) };
              state.grid.push(leg);
            }
          }
        }
        state.lastDecisionUtc = utc;
        console.log(JSON.stringify({
          event: 'hybrid_decision', equity, dayPnl, held: Object.fromEntries(held),
          momentum: state.momentum.map((leg) => leg.symbol), gridLevels: state.grid.length,
        }));
      }
      await writeState(state);
    } catch (error) {
      console.error(JSON.stringify({ event: 'hybrid_tick_error', message: error instanceof Error ? error.message : 'tick failed' }));
    } finally {
      busy = false;
    }
  };

  console.log(JSON.stringify({ event: 'hybrid_live_started', sizing: '100u-book', dailyLossUsd: HYBRID_LIVE.dailyLossUsd }));
  await tick();
  setInterval(() => { void tick(); }, 30_000);
}

void main();
